const koaRouter = require('koa-router')
const { logger, dao, LoadServiceInfo } = require('./common')
const { BuildConfigForNetwork } = require('./tunnel')

const router = new koaRouter({
    prefix: '/tunnel',
})

router.get('/list', async ctx => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    const result = await dao.getTunnelConfigByHost(network, host)
    const frps = []
    const frpc = []
    const gost = []
    result.forEach(row => {
        if (row.name.startsWith('frps-')) {
            frps.push({
                name: row.name,
                hash: row.config_hash,
            })
        }

        if (row.name.startsWith('frpc-')) {
            frpc.push({
                name: row.name,
                hash: row.config_hash,
            })
        }

        if (row.name.startsWith('gost-')) {
            gost.push({
                name: row.name,
                hash: row.config_hash,
            })
        }
    })

    ctx.body = {
        frps,
        frpc,
        gost,
    }
})

router.post('/refresh', async ctx => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network } = serviceInfo
    await BuildConfigForNetwork(network)

    ctx.body = 'OK'
})

router.get('/config', async ctx => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo
    const { name } = ctx.query

    const config = await dao.getTunnelConfig(network, host, name)
    if (!config) {
        ctx.status = 404
        return
    }

    ctx.body = {
        data: config.config,
    }
})

router.post('/report', ctx => {
    ctx.body = 'OK'
})

module.exports = router
