import assert from "assert";
import crypto from "crypto";
import { Context } from "koa";
import koaRouter from "koa-router";
import z from "zod";

import { dao } from "./common";
import { CheckJoinClusterToken } from "./simple-token";
import { ClientKeyWrapper } from "./client-pki";
import { _nodeConfigSchema, NodeInfo } from "./model";
import { GetAllAddressFromLinkNetworkCIDR } from "utils";
import {
    WGLINK_ENDPOINT_MODE_CLIENT_RESOLVE,
    WGLINK_ENDPOINT_MODE_PLAINTEXT,
    WGLINK_ENDPOINT_MODE_SERVER_RESOLVE,
    WGLINK_TYPE_CLIENT,
    WGLINK_TYPE_SERVER,
} from "consts";

const router = new koaRouter({
    prefix: "/api/v1/node",
});
export default router;

async function verifyClientRequest(ctx: Context): Promise<NodeInfo | null> {
    const clientKeyID = ctx.get("X-Client-ID");
    const nonce = ctx.get("X-Client-Nonce");
    const signature = ctx.get("X-Client-Sign");
    const clientInfo = await dao.getNodeInfoBySignKeyHash(clientKeyID);
    if (clientInfo === null) {
        return null;
    }

    const pubkey = crypto.createPublicKey(clientInfo.publicSignKey); // DER format

    if (ctx.method === "GET") {
        const signData = `${ctx.path}\n${nonce}\n${ctx.querystring}`;
        if (
            !crypto.verify(
                null,
                Buffer.from(signData),
                pubkey,
                Buffer.from(signature, "base64")
            )
        ) {
            // signature verification failed
            console.log(`Invalid signature: ${signature}`);
            return null;
        }
    } else if (ctx.method === "POST") {
        const signData = `${ctx.path}\n${nonce}\n${ctx.request.body}`;
        if (
            !crypto.verify(
                null,
                Buffer.from(signData),
                pubkey,
                Buffer.from(signature, "base64")
            )
        ) {
            // signature verification failed
            console.log(`Invalid signature: ${signature}`);
            return null;
        }
    } else {
        console.log(`Invalid method: ${ctx.method}`);
        return null;
    }

    return clientInfo;
}

async function mustVerifyClient(ctx: Context): Promise<NodeInfo | null> {
    const clientInfo = await verifyClientRequest(ctx);
    if (clientInfo === null) {
        ctx.status = 401;
        return null;
    }

    return clientInfo;
}

router.post("/join", async (ctx) => {
    const body = z
        .object({
            token: z.string(),
            publicSignKey: z.string(), // PEM format
            name: z.string(),
        })
        .safeParse(ctx.request.body);

    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { token, publicSignKey, name } = body.data;

    const cluster = CheckJoinClusterToken(token);
    if (cluster === null) {
        console.log(`Invalid join token: ${token}`);

        ctx.status = 400;
        return;
    }

    let clientPublicSignKey: ClientKeyWrapper;
    try {
        clientPublicSignKey = new ClientKeyWrapper(publicSignKey);
    } catch (e) {
        console.log(`Invalid public sign key: ${publicSignKey}`);
        console.log(e);
        ctx.status = 400;
        ctx.body = `Invalid public sign key`;
        return;
    }

    const newNodeId = `${crypto.randomUUID()}`;
    await dao.createNodeInfo(
        cluster,
        newNodeId,
        name,
        clientPublicSignKey.toPEM(),
        clientPublicSignKey.getKeyHash(),
        ""
    );

    ctx.body = {
        cluster,
        id: newNodeId,
    };
});

// Node Configs

router.get("/config", async (ctx) => {
    const clientInfo = await mustVerifyClient(ctx);
    if (clientInfo === null) return;

    const nodeConfig = _nodeConfigSchema.parse(clientInfo.config);
    ctx.body = nodeConfig;
});

router.post("/status", async (ctx) => {
    const clientInfo = await mustVerifyClient(ctx);
    if (clientInfo === null) return;

    // TODO: update status to db
    ctx.body = "OK";
});

// Keys

router.post("/sync_wireguard_keys", async (ctx) => {
    const clientInfo = await mustVerifyClient(ctx);
    if (clientInfo === null) return;

    const body = z
        .object({
            // these are wireguard public keys of keypairs generated by client. private keys are always stored locally.
            keys: z.string().array(),
        })
        .safeParse(ctx.request.body);

    if (!body.success) {
        ctx.status = 400;
        ctx.body = `Invalid request: ${body.error}`;
        return;
    }

    const { keys } = body.data;
    const { id: nodeId } = clientInfo;
    await dao.updateNodeWireGuardKeys(nodeId, keys);

    ctx.body = "OK";
});

router.get("/peers", async (ctx) => {
    const clientInfo = await mustVerifyClient(ctx);
    if (clientInfo === null) return;

    const { id: nodeId } = clientInfo;
    const links = await dao.getEnabledWireGuardLinks(nodeId);

    // Compose wglinks
    const composedLinks = await Promise.all(
        links.map(async (link) => {
            const publicKey = await dao.getWireGuardKeyById(link.wgKeyId);
            assert(publicKey !== null, `Invalid key id: ${link.wgKeyId}`);
            const peerNode = await dao.getNodeInfoById(link.peerNodeId);
            assert(
                peerNode !== null,
                `Invalid peer node id: ${link.peerNodeId}`
            );
            const peerPublicKey = await dao.getWireGuardKeyById(
                link.peerPublicKeyId
            );
            assert(
                peerPublicKey !== null,
                `Invalid peer key id: ${link.peerPublicKeyId}`
            );
            const subnet = await dao.getClusterSubnetById(link.subnetId);
            assert(subnet !== null, `Invalid subnet id: ${link.subnetId}`);

            return {
                ...link,
                subnetCIDR: subnet.subnetCIDR,
                publicKey: publicKey.publicKey,
                peerNode,
                peerPublicKey: peerPublicKey.publicKey,
            };
        })
    );

    const peers = composedLinks.map((link) => {
        const addresses = GetAllAddressFromLinkNetworkCIDR(link.subnetCIDR);
        let addressCIDR: string;
        if (link.type === WGLINK_TYPE_SERVER) {
            addressCIDR = addresses[0];
        } else if (link.type === WGLINK_TYPE_CLIENT) {
            addressCIDR = addresses[1];
        } else {
            throw new Error(
                `Invalid link type: ${link.type} for link ${link.id}`
            );
        }

        // build endpoint
        let endpoint: string;
        if (link.endpointMode === WGLINK_ENDPOINT_MODE_PLAINTEXT) {
            endpoint = link.endpoint;
        } else if (link.endpointMode === WGLINK_ENDPOINT_MODE_CLIENT_RESOLVE) {
            endpoint = link.endpointTemplate;
        } else if (link.endpointMode === WGLINK_ENDPOINT_MODE_SERVER_RESOLVE) {
            // TODO: service side rendering.
            endpoint = link.endpointTemplate;
        } else {
            endpoint = "";
        }

        return {
            id: link.id,
            publicKey: link.publicKey, // client need to figure out which private key to use.
            listenPort: link.listenPort,
            mtu: link.mtu,
            addressCIDR,

            peerPublicKey: link.peerPublicKey,
            keepalive: link.keepalive,
            endpoint,
            // allowedIPs: ... // client side just allow all.

            extra: link.extra,
        };
    });

    ctx.body = {
        peers,
    };
});
