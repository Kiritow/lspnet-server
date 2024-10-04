import koaRouter from "koa-router";
import { dao, LoadServiceInfo } from "./common";
import { Context } from "koa";
import { z } from "zod";

export const router = new koaRouter({
    prefix: "/wg",
});

router.get("/list", async (ctx: Context) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const results = await dao.getAllKeys(network, host);
    if (results == null) {
        ctx.body = {};
        return;
    }

    ctx.body = results.reduce<{ [key: string]: string }>((acc, key) => {
        acc[key.name] = key.pubkey;
        return acc;
    }, {});
});

router.post("/create", async (ctx: Context) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const body = z
        .object({
            name: z.string(),
            key: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { name, key } = body.data;
    await dao.addOrUpdateKey(network, host, name, key);
    ctx.body = "OK";
});

async function tryAddKey(network: string, targetHost: string, keyName: string) {
    const key = await dao.getKey(network, targetHost, keyName);
    if (key == null) {
        await dao.addKey(network, targetHost, keyName, "");
        return {
            host: targetHost,
            name: keyName,
            status: "pending",
        };
    } else if (key.length < 1) {
        return {
            host: targetHost,
            name: keyName,
            status: "pending",
        };
    } else {
        return {
            host: targetHost,
            name: keyName,
            status: "ready",
            key,
        };
    }
}

router.post("/request", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const body = z
        .object({
            host: z.string(),
            name: z.string().optional(),
        })
        .safeParse(ctx.request.body);

    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { host: targetHost, name } = body.data;
    const keyName = name || host;

    ctx.body = await tryAddKey(network, targetHost, keyName);
});

router.post("/batch_request", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const body = z
        .array(
            z.object({
                host: z.string(),
                name: z.string().optional(),
            })
        )
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }

    ctx.body = await Promise.all(
        body.data.map(async (r) => {
            const { host: targetHost, name } = r;
            const keyName = name || host;
            return await tryAddKey(network, targetHost, keyName);
        })
    );
});
