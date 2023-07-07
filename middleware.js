const { CheckServiceToken, CreateServiceToken } = require('./token')

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

function NewAsyncTokenRenewMW(renewConfig) {
    return async (ctx, next) => {
        const { 'x-service-token': token } = ctx.headers
        if (token != null) {
            const tokenInfo = CheckServiceToken(token)
            if (tokenInfo != null) {
                const tokenData = tokenInfo.data
                const secondsLeft = tokenInfo.exp - Math.floor(new Date().getTime() / 1000)

                if (tokenData.renew === true && renewConfig[tokenData.type] != null) {
                    const { renew: renewSeconds, expire: expireSeconds } = renewConfig[tokenData.type]
                    if (secondsLeft < renewSeconds) {
                        logger.info(`renew token with: ${JSON.stringify(tokenData)}`)
                        const newToken = CreateServiceToken(tokenData, expireSeconds)
                        ctx.set('x-renew-service-token', newToken)
                    }
                }
            }
        }

        await next()
    }
}

module.exports = {
    NewAsyncRootMW,
    NewAsyncTokenRenewMW,
}
