import koaRouter from "koa-router";
import { logger, dao, GetRequestToken } from "./common";
import { CheckTunnelPullToken } from "./simple-token";
import { BuildConfigForNetwork } from "./tunnel";
import { z } from "zod";

export const router = new koaRouter({
    prefix: "/tunnel",
});

interface finalConfigSummary {
    name: string;
    hash: string;
}

router.get("/list", async (ctx) => {
    const serviceInfo = CheckTunnelPullToken(GetRequestToken(ctx));
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const result = await dao.getTunnelConfigByHost(network, host);
    const frps: finalConfigSummary[] = [];
    const frpc: finalConfigSummary[] = [];
    const gost: finalConfigSummary[] = [];
    result.forEach((row) => {
        if (row.name.startsWith("frps-")) {
            frps.push({
                name: row.name,
                hash: row.config_hash,
            });
        }

        if (row.name.startsWith("frpc-")) {
            frpc.push({
                name: row.name,
                hash: row.config_hash,
            });
        }

        if (row.name.startsWith("gost-")) {
            gost.push({
                name: row.name,
                hash: row.config_hash,
            });
        }
    });

    ctx.body = {
        frps,
        frpc,
        gost,
    };
});

router.post("/refresh", async (ctx) => {
    const serviceInfo = CheckTunnelPullToken(GetRequestToken(ctx));
    if (serviceInfo == null) return;

    const { network } = serviceInfo;
    await BuildConfigForNetwork(network);

    ctx.body = "OK";
});

router.get("/config", async (ctx) => {
    const serviceInfo = CheckTunnelPullToken(GetRequestToken(ctx));
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;
    const query = z
        .object({
            name: z.string(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        return;
    }

    const { name } = query.data;

    const config = await dao.getTunnelConfig(network, host, name);
    if (!config) {
        ctx.status = 404;
        return;
    }

    ctx.body = {
        data: config.config,
    };
});

router.post("/report", async (ctx) => {
    const serviceInfo = CheckTunnelPullToken(GetRequestToken(ctx));
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;
    const body = z
        .object({
            running: z.array(z.string()),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { running } = body.data;

    logger.info(
        `network: ${network} host: ${host} running: ${running.join(",")}`
    );
    await dao.heartbeatTunnelMeta(network, host);

    ctx.body = "OK";
});
