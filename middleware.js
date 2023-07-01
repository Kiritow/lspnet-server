const logger = require('./base-log')('app')

function NewAsyncRootMW() {
    return async (ctx, next) => {
        const startTime = new Date()

        try {
            logger.info(`${ctx.method} ${ctx.URL}`)
            logger.info(ctx.headers)

            await next()
        } catch (e) {
            logger.error(e)

            ctx.status = 500
            ctx.body = 'server internal error'
        }

        logger.info(`${ctx.method} ${ctx.URL} [${ctx.status}] (${new Date().getTime() - startTime.getTime()}ms)`)
    }
}

module.exports = {
    NewAsyncRootMW,
}
