import crypto from "crypto";
import { Context } from "koa";
import koaRouter from "koa-router";
import z from "zod";

import { dao } from "./common";
import { CheckJoinClusterToken } from "./simple-token";
import { ClientKeyWrapper } from "./client-pki";
import { _nodeConfigSchema } from "model";

const router = new koaRouter({
    prefix: "/api/v1/node",
});
export default router;

async function verifyClientRequest(ctx: Context) {
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

async function mustVerifyClient(ctx: Context) {
    const clientInfo = await verifyClientRequest(ctx);
    if (clientInfo === null) {
        ctx.status = 401;
        return null;
    }

    return clientInfo;
}

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
