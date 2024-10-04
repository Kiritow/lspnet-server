import koa from "koa";
import koaBodyParser from "koa-bodyparser";
import koaJSON from "koa-json";
import koaRouter from "koa-router";
import koaSession from "koa-session";
import z from "zod";

import { NewAsyncRootMW } from "./middleware";
import { router as wgRouter } from "./wg-api";
import { router as linkRouter } from "./link-api";
import { router as tunnelRouter } from "./tunnel-api";
import { router as authRouter } from "./oauth-api";
import { router as adminRouter } from "./admin-api";
import { LoadServiceInfo, logger } from "./common";
import { GetKoaAppSecretSync } from "./credentials";
import {
    CreateReportToken,
    CreateSimpleToken,
    CheckAuthToken,
} from "./simple-token";

const app = new koa({
    proxy: true,
});
app.keys = GetKoaAppSecretSync();
app.use(
    koaSession(
        {
            key: "ss_token",
            maxAge: 86400000,
            autoCommit: true,
            overwrite: true,
            httpOnly: true,
            signed: true,
            rolling: false,
            renew: false,
            secure: true, // we have nginx/cloudflare in front of us.
        },
        app
    )
);

app.use(koaBodyParser());
app.use(koaJSON());
app.use(NewAsyncRootMW());

const router = new koaRouter();
router.get("/", (ctx) => {
    ctx.body = "OK";
});

router.post("/token", async (ctx) => {
    const body = z
        .object({
            network: z.string(),
            host: z.string(),
            token: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { network, host, token } = body.data;

    if (CheckAuthToken(token) == null) {
        ctx.status = 401;
        return;
    }

    ctx.body = CreateSimpleToken(network, host);
});

router.post("/report_token", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    ctx.body = CreateReportToken(network, host);
});

router.get("/info", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx, []);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    ctx.body = {
        network,
        host,
    };
});

app.use(wgRouter.routes()).use(wgRouter.allowedMethods());
app.use(linkRouter.routes()).use(linkRouter.allowedMethods());
app.use(tunnelRouter.routes()).use(tunnelRouter.allowedMethods());
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());
app.use(router.routes()).use(router.allowedMethods());

app.listen(6666);
logger.info("Server started on port 6666");
