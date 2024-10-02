import Application, { Context, Middleware } from "koa";
import getOrCreateLogger from "./base-log";

const logger = getOrCreateLogger("app");

export function NewAsyncRootMW(): Middleware {
    return async (ctx: Context, next: Application.Next) => {
        const startTime = new Date();

        try {
            logger.info(`${ctx.method} ${ctx.URL}`);
            logger.info(ctx.headers);

            await next();
        } catch (e) {
            console.log(e);
            logger.error(e);

            ctx.status = 500;
            ctx.body = "server internal error";
        }

        logger.info(
            `${ctx.method} ${ctx.URL} [${ctx.status}] (${new Date().getTime() - startTime.getTime()}ms)`
        );
    };
}
