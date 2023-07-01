const koa = require('koa')
const koaBodyParser = require('koa-bodyparser')
const koaJSON = require('koa-json')
const koaRouter = require('koa-router')
const { NewAsyncRootMW } = require('./middleware')
const { CreateServiceToken } = require('./token')
const wgRouter = require('./wg-api')
const linkRouter = require('./link-api')
const { LoadServiceInfo, logger } = require('./common')


const app = new koa()
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
        ctx.status = 403
        return
    }

    ctx.body = CreateServiceToken({
        type: 'simple',
        host,
        network,
    }, 3600)
})

router.get('/info', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    ctx.body = {
        network, host,
    }
})

app.use(wgRouter.routes()).use(wgRouter.allowedMethods())
app.use(linkRouter.routes()).use(linkRouter.allowedMethods())
app.use(router.routes()).use(router.allowedMethods())

app.listen(6666)
logger.info('Server started on port 6666')