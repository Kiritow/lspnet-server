import "source-map-support/register";
import koa from "koa";
import koaBodyParser from "koa-bodyparser";
import koaJSON from "koa-json";
import koaRouter from "koa-router";
import koaSession from "koa-session";

import { NewAsyncRootMW } from "./middleware";
import authRouter from "./auth-api";
import adminRouter from "./admin-api";
import nodeRouter from "./node-api";
import { logger } from "./common";
import { GetKoaAppSecretSync } from "./credentials";

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

app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());
app.use(nodeRouter.routes()).use(nodeRouter.allowedMethods());
app.use(router.routes()).use(router.allowedMethods());

app.listen(6666);
logger.info("Server started on port 6666");
