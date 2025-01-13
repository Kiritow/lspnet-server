import fs from "fs";
import assert from "assert";
import crypto from "crypto";
import Application, { Context } from "koa";
import koaRouter from "koa-router";
import { z } from "zod";
import { dao, LoadServiceInfo } from "./common";
import { SecureMessage, SecureChannelServer } from "./secure-channel";
import getRawBody from "raw-body";

// ---- TESTING PURPOSE ----
// create new key
function loadPrivateSignKey(filePath: string): crypto.KeyObject {
    const content = fs.readFileSync(filePath);
    const key = crypto.createPrivateKey(content);
    assert(
        key.type === "private" && key.asymmetricKeyType === "ed25519",
        "invalid key type"
    );
    return key;
}

function loadPublicSignKey(filePath: string): crypto.KeyObject {
    const content = fs.readFileSync(filePath);
    const key = crypto.createPublicKey(content);
    assert(
        key.type === "public" && key.asymmetricKeyType === "ed25519",
        "invalid key type"
    );
    return key;
}

async function keyLoader(keyName: string): Promise<crypto.KeyObject> {
    return loadPublicSignKey("client-public-sign-key.pem");
}
// ---- END OF TESTING PURPOSE ----

function eccPublicKeyFromDer(raw: Buffer): crypto.KeyObject {
    return crypto.createPublicKey({
        key: raw,
        format: "der",
        type: "spki",
    });
}

const secureChannelServer = new SecureChannelServer(
    loadPrivateSignKey("server-private-sign-key.pem"),
    keyLoader
);

const router = new koaRouter({
    prefix: "/node",
});

export default router;

router.post("/connect", async (ctx: Context) => {
    const body = z
        .object({
            name: z.string(),
            key: z.string(),
            sign: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { name, key, sign } = body.data;
    try {
        const result = await secureChannelServer.createSession(
            name,
            Buffer.from(key, "base64"),
            Buffer.from(sign, "base64"),
            eccPublicKeyFromDer
        );
        ctx.body = {
            cid: result.connId,
            key: result.publicKey.toString("base64"),
            sign: result.sign.toString("base64"),
            data: result.data.toString("base64"),
        };
    } catch (e) {
        console.log(e);
        ctx.status = 401;
    }
});

interface DecryptJSONResult<T> {
    cid: number;
    body: T;
}

async function bodyDecryptJSON<T>(body: Buffer): Promise<DecryptJSONResult<T>> {
    const message = SecureMessage.fromBuffer(body);
    const session = await secureChannelServer.getSession(message.connId);
    if (session === undefined) {
        throw new Error("invalid connection id");
    }
    const plaintext = session.decryptSync(message);
    return {
        cid: message.connId,
        body: JSON.parse(plaintext.toString("utf8")),
    };
}

async function respEncryptJSON(cid: number, body: unknown): Promise<Buffer> {
    const message = Buffer.from(JSON.stringify(body), "utf8");
    const session = await secureChannelServer.getSession(cid);
    if (session === undefined) {
        throw new Error("invalid connection id");
    }
    return session.encryptSync(message).toBuffer();
}

async function secureLayerMW(ctx: Context, next: Application.Next) {
    const raw = await getRawBody(ctx.req);
    const { body, cid } = await bodyDecryptJSON<unknown>(raw);
    ctx.request.body = body;

    try {
        await next();

        ctx.body = await respEncryptJSON(cid, ctx.body);
    } catch (e) {
        console.log(e);
        ctx.body = undefined;
        ctx.status = 500;
        throw e;
    }
}

router.post("/send", secureLayerMW, async (ctx: Context) => {
    console.log(ctx.request.body);
    ctx.body = {
        message: "hello world from server",
    };
});
