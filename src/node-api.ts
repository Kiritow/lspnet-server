import assert from "assert";
import { Context } from "koa";
import koaRouter from "koa-router";
import z from "zod";

import { dao } from "./common";
import { CheckJoinClusterToken } from "./simple-token";
import { ClientKeyWrapper } from "./client-pki";
import { NodeInfo } from "./model";
import {
    GetAllAddressFromLinkNetworkCIDR,
    parseNodeConfig,
    readableZodError,
} from "./utils";
import {
    WGLINK_ENDPOINT_MODE_CLIENT_RESOLVE,
    WGLINK_ENDPOINT_MODE_PLAINTEXT,
    WGLINK_ENDPOINT_MODE_SERVER_RESOLVE,
    WGLINK_TYPE_CLIENT,
    WGLINK_TYPE_SERVER,
} from "./consts";

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
        console.log(`Invalid client key id: ${clientKeyID}`);
        return null;
    }

    const clientPublicKey = new ClientKeyWrapper(clientInfo.publicSignKey);

    if (ctx.method === "GET") {
        const signData = `${ctx.path}\n${nonce}\n${ctx.querystring}`;
        if (
            !clientPublicKey.checkSignature(
                Buffer.from(signData),
                Buffer.from(signature, "hex")
            )
        ) {
            // signature verification failed
            console.log(`Invalid signature: ${signature}`);
            return null;
        }
    } else if (ctx.method === "POST") {
        const signData = `${ctx.path}\n${nonce}\n${ctx.request.rawBody}`;
        console.log(`Sign data: ${signData}`);
        if (
            !clientPublicKey.checkSignature(
                Buffer.from(signData),
                Buffer.from(signature, "hex")
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
        ctx.body = readableZodError(body.error);
        return;
    }

    const { token, publicSignKey, name } = body.data;

    const tokenData = CheckJoinClusterToken(token);
    if (tokenData === null) {
        console.log(`Invalid join token: ${token}`);

        ctx.status = 400;
        ctx.body = `Invalid join token`;
        return;
    }

    const { clusterId, createUserId } = tokenData;
    const cluster = await dao.getClusterInfo(clusterId);
    if (cluster === null) {
        console.log(`Invalid cluster id: ${clusterId}`);
        ctx.status = 400;
        ctx.body = `Invalid join token: cluster not found`;
        return;
    }
    const userRole = await dao.getUserRole(createUserId, clusterId);
    if (userRole === null) {
        console.log(`Invalid user role: ${createUserId}`);
        ctx.status = 400;
        ctx.body = `Invalid join token: create user not found`;
        return;
    }
    if (userRole !== 2) {
        console.log(
            `User role is not admin: ${userRole} for cluster: ${clusterId}`
        );
        ctx.status = 403;
        ctx.body = `Invalid join token: permission denied`;
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

    const newNodeId = await dao.createNodeInfo(
        clusterId,
        name,
        clientPublicSignKey.toPEM(),
        clientPublicSignKey.getKeyHash(),
        ""
    );

    ctx.body = {
        id: newNodeId,
    };
});

// Node Configs

router.get("/info", async (ctx) => {
    const nodeInfo = await mustVerifyClient(ctx);
    if (nodeInfo === null) return;

    ctx.body = {
        id: nodeInfo.id,
        clusterId: nodeInfo.clusterId,
        nodeName: nodeInfo.nodeName,
        publicSignKey: nodeInfo.publicSignKey,
        publicSignKeyHash: nodeInfo.publicSignKeyHash,
        status: nodeInfo.status,
        lastSeen: nodeInfo.lastSeen,
    };
});

router.get("/config", async (ctx) => {
    const nodeInfo = await mustVerifyClient(ctx);
    if (nodeInfo === null) return;

    try {
        parseNodeConfig(nodeInfo.config);
    } catch (e) {
        console.log(e);
        console.log(
            `[WARNING] node ${nodeInfo.id} config is invalid: ${e instanceof Error ? e.message : e}`
        );
        ctx.status = 202;
        ctx.body = {
            message: "config not ready yet.",
        };
        return;
    }

    ctx.body = {
        config: nodeInfo.config, // raw JSON string. for client hash and versioning.
    };
});

router.post("/status", async (ctx) => {
    const nodeInfo = await mustVerifyClient(ctx);
    if (nodeInfo === null) return;

    // TODO: update status to db
    ctx.body = {
        message: "OK",
    };
});

// Keys

router.post("/sync_wireguard_keys", async (ctx) => {
    const nodeInfo = await mustVerifyClient(ctx);
    if (nodeInfo === null) return;

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
    await dao.updateNodeWireGuardKeys(nodeInfo.id, keys);

    ctx.body = {
        message: "OK",
    };
});

router.get("/peers", async (ctx) => {
    const nodeInfo = await mustVerifyClient(ctx);
    if (nodeInfo === null) return;

    const links = await dao.getEnabledWireGuardLinks(nodeInfo.id);

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
        let useEndpoint: string;
        if (link.endpointMode === WGLINK_ENDPOINT_MODE_PLAINTEXT) {
            useEndpoint = link.endpoint;
        } else if (link.endpointMode === WGLINK_ENDPOINT_MODE_CLIENT_RESOLVE) {
            useEndpoint = link.endpointTemplate;
        } else if (link.endpointMode === WGLINK_ENDPOINT_MODE_SERVER_RESOLVE) {
            // TODO: service side rendering.
            useEndpoint = link.endpointTemplate;
        } else {
            useEndpoint = "";
        }

        return {
            id: link.id,
            publicKey: link.publicKey, // client need to figure out which private key to use.
            listenPort: link.listenPort,
            mtu: link.mtu,
            addressCIDR,

            peerPublicKey: link.peerPublicKey,
            keepalive: link.keepalive,
            endpoint: useEndpoint,
            // allowedIPs: ... // client side just allow all.

            extra: link.extra,
        };
    });

    ctx.body = {
        peers,
    };
});
