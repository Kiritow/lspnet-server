import crypto from "crypto";
import koaRouter from "koa-router";
import { CreateAuthToken, CreateTunnelPullToken } from "./simple-token";

import { logger, dao } from "./common";
import { BuildConfigForNetworkAsync } from "./tunnel";
import { Context } from "koa";
import { z } from "zod";

const router = new koaRouter({
    prefix: "/admin",
});

export default router;

router.use(async (ctx, next) => {
    try {
        await next();
    } catch (e) {
        logger.error(e);

        ctx.status = 500;
        ctx.body = {
            message: `server internal error: ${e}`,
        };
    }
});

async function getWebUser(ctx: Context) {
    if (ctx.session == null) {
        return null;
    }

    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        return null;
    }

    const accountInfo = await dao.getUserByID(ctx.session.uid);
    if (accountInfo == null) {
        logger.warn(`invalid uid: ${ctx.session.uid}`);
        return null;
    }

    return accountInfo;
}

async function mustLogin(ctx: Context) {
    const accountInfo = await getWebUser(ctx);
    if (!accountInfo) {
        ctx.body = {
            message: "user not logged in",
        };
        return;
    }

    return accountInfo;
}

router.get("/user", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    ctx.body = {
        message: "ok",
        data: {
            username: accountInfo.uname,
        },
    };
});

router.post("/token", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const authToken = CreateAuthToken();
    ctx.body = {
        message: "ok",
        data: {
            token: authToken,
        },
    };
});

router.post("/tunnel/token", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const body = z
        .object({
            network: z.string(),
            host: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        ctx.body = {
            message: "invalid network or host",
        };
        return;
    }

    const { network, host } = body.data;

    ctx.body = {
        message: "ok",
        data: {
            token: CreateTunnelPullToken(network, host),
        },
    };
});

router.get("/tunnel/list", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const query = z
        .object({
            network: z.string(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        ctx.body = {
            message: "invalid network",
        };
        return;
    }

    const { network } = query.data;
    const allTunnels = await dao.getAllTunnels(network, false);

    ctx.body = {
        message: "ok",
        data: allTunnels.map((row) => ({
            id: row.id,
            network: row.network,
            type: {
                0: "frp",
                1: "gost",
            }[row.type],
            protocol: {
                0: "tcp",
                1: "udp",
                2: "http",
            }[row.protocol],
            host: row.host,
            listen: row.listen,
            targetHost: row.target_host,
            targetIP: row.target_ip,
            targetPort: row.target_port,
            description: row.description,
            status: row.status == 0 ? true : false,
        })),
    };
});

router.post("/tunnel/create", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const body = z
        .object({
            network: z.string(),
            type: z.union([z.literal("frp"), z.literal("gost")]),
            protocol: z.union([
                z.literal("tcp"),
                z.literal("udp"),
                z.literal("http"),
            ]),
            host: z.string(),
            listen: z.coerce.number().int(),
            targetHost: z.string().optional(),
            targetIP: z.string().optional(),
            targetPort: z.coerce.number().int().optional(),
            description: z.string().optional(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        ctx.body = {
            message: `invalid request: ${body.error.message}`,
        };
        return;
    }

    const {
        network,
        type,
        protocol,
        host,
        listen,
        targetHost,
        targetIP,
        targetPort,
        description,
    } = body.data;

    const realType = {
        frp: 0,
        gost: 1,
    }[type];

    const realProtocol = {
        tcp: 0,
        udp: 1,
        http: 2,
    }[protocol];

    // http proxy does not use target_port
    if (realProtocol != 2 && targetPort === undefined) {
        ctx.status = 400;
        ctx.body = {
            message: "invalid target host",
        };
        return;
    }

    if (realType == 0 && !targetHost) {
        ctx.body = {
            message: "invalid target host",
        };
        return;
    }

    if ((await dao.getTunnelMetaByHost(network, host)) == null) {
        ctx.body = {
            message: `invalid host: ${host}`,
        };
        return;
    }

    if (targetHost !== undefined) {
        if ((await dao.getTunnelMetaByHost(network, targetHost)) == null) {
            ctx.body = {
                message: `invalid target host: ${targetHost}`,
            };
            return;
        }
    }

    await dao.createTunnel(
        network,
        realType,
        realProtocol,
        host,
        listen,
        targetHost !== undefined ? targetHost : "",
        targetIP !== undefined ? targetIP : "127.0.0.1",
        targetPort !== undefined ? targetPort : 0,
        description !== undefined ? description : ""
    );
    BuildConfigForNetworkAsync(network);

    ctx.body = {
        message: "ok",
    };
});

router.post("/tunnel/disable", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const body = z
        .object({
            id: z.coerce.number().int(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        console.log(body.error);
        ctx.status = 400;
        return;
    }

    const { id } = body.data;
    const tunnel = await dao.getTunnelById(id);
    if (!tunnel) {
        ctx.body = {
            message: "invalid tunnel",
        };
        return;
    }

    await dao.setTunnelStatus(tunnel.id, false);
    BuildConfigForNetworkAsync(tunnel.network);

    ctx.body = {
        message: "ok",
    };
});

router.post("/tunnel/enable", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const body = z
        .object({
            id: z.coerce.number().int(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        console.log(body.error);
        ctx.status = 400;
        return;
    }

    const { id } = body.data;
    const tunnel = await dao.getTunnelById(id);
    if (!tunnel) {
        ctx.body = {
            message: "invalid tunnel",
        };
        return;
    }
    await dao.setTunnelStatus(tunnel.id, true);
    BuildConfigForNetworkAsync(tunnel.network);

    ctx.body = {
        message: "ok",
    };
});

router.get("/host/list", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const query = z
        .object({
            network: z.string(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        return;
    }

    const { network } = query.data;

    const allTunnelMeta = await dao.getAllTunnelMeta(network);
    ctx.body = {
        message: "ok",
        data: allTunnelMeta.map((row) => ({
            network: row.network,
            host: row.host,
            ip: row.ip,
            frpsPort: row.frps_port,
        })),
    };
});

router.post("/host/create", async (ctx) => {
    const accountInfo = await mustLogin(ctx);
    if (!accountInfo) return;

    const body = z
        .object({
            network: z.string(),
            host: z.string(),
            ip: z.string(),
            frpsPort: z.coerce.number().int().optional(),
        })
        .safeParse(ctx.request.body);

    if (!body.success) {
        console.log(body.error);
        ctx.status = 400;
        return;
    }

    const { network, host, frpsPort } = body.data;

    const realPort = frpsPort !== undefined ? frpsPort : 7000;
    const newToken = crypto.randomBytes(128).toString("base64");
    await dao.createTunnelMeta(network, host, realPort, newToken);

    ctx.body = {
        message: "ok",
    };
});
