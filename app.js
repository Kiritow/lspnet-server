const koa = require('koa')
const koaBodyParser = require('koa-bodyparser')
const koaJSON = require('koa-json')
const koaRouter = require('koa-router')
const koaSession = require('koa-session')

const { NewAsyncRootMW } = require('./middleware')
const wgRouter = require('./wg-api')
const linkRouter = require('./link-api')
const tunnelRouter = require('./tunnel-api')
const authRouter = require('./oauth-api')
const adminRouter = require('./admin-api')
const { LoadServiceInfo, logger } = require('./common')
const { GetKoaAppSecretSync } = require('./credentials')
const { CreateReportToken, CreateSimpleToken, CheckAuthToken } = require('./simple-token')


const app = new koa({
    proxy: true,
})
app.keys = GetKoaAppSecretSync()
app.use(koaSession({
    key: 'ss_token',
    maxAge: 86400000,
    autoCommit: true,
    overwrite: true,
    httpOnly: true,
    signed: true,
    rolling: false,
    renew: false,
    secure: true,  // we have nginx/cloudflare in front of us.
}, app))

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

    if (CheckAuthToken(token) == null) {
        ctx.status = 401
        return
    }

    ctx.body = CreateSimpleToken(network, host)
})

router.post('/report_token', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    ctx.body = CreateReportToken(network, host)
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
app.use(tunnelRouter.routes()).use(tunnelRouter.allowedMethods())
app.use(authRouter.routes()).use(authRouter.allowedMethods())
app.use(adminRouter.routes()).use(adminRouter.allowedMethods())
app.use(router.routes()).use(router.allowedMethods())

app.listen(6666)
logger.info('Server started on port 6666')
