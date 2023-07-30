const koa = require('koa')
const koaBodyParser = require('koa-bodyparser')
const koaJSON = require('koa-json')
const koaRouter = require('koa-router')
const { NewAsyncRootMW } = require('./middleware')
const { CreateServiceToken } = require('./token')
const wgRouter = require('./wg-api')
const linkRouter = require('./link-api')
const authRouter = require('./oauth-api')
const { LoadServiceInfo, CheckServiceTokenWithType, logger } = require('./common')


const app = new koa({
    proxy: true,
})
app.use(koaBodyParser())
app.use(koaJSON())
app.use(NewAsyncRootMW())

const router = new koaRouter()
router.get('/', (ctx) => {
    ctx.body = 'OK'
})

router.post('/token', async (ctx) => {
    const { network, host, token } = ctx.request.body
    if (network == null || host == null || token == null) {
        ctx.status = 400
        return
    }

    if (CheckServiceTokenWithType(token, ['auth']) == null) {
        ctx.status = 401
        return
    }

    ctx.body = CreateServiceToken({
        type: 'simple',
        host,
        network,
    }, 3600)
})

router.post('/report_token', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    ctx.body = CreateServiceToken({
        type: 'report',
        renew: true,
        host,
        network,
    }, 100 * 86400)
})

router.get('/info', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx, [])
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    ctx.body = {
        network, host,
    }
})

app.use(wgRouter.routes()).use(wgRouter.allowedMethods())
app.use(linkRouter.routes()).use(linkRouter.allowedMethods())
app.use(authRouter.routes()).use(authRouter.allowedMethods())
app.use(router.routes()).use(router.allowedMethods())

app.listen(6666)
logger.info('Server started on port 6666')
