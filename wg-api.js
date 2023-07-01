const koaRouter = require('koa-router')
const { logger, dao, LoadServiceInfo } = require('./common')

const router = new koaRouter({
    prefix: '/wg',
})

router.get('/list', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return 

    const { network, host } = serviceInfo

    const results = await dao.getAllKeys(network, host)
    if (results == null) {
        ctx.body = {}
        return
    }

    const data = {}
    results.forEach(row => data[row.name] = row.pubkey)
    ctx.body = data
})

router.post('/create', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    const { name, key } = ctx.request.body
    if (name == null || key == null) {
        ctx.status = 400
        return
    }

    await dao.addOrUpdateKey(network, host, name, key)
    ctx.body = 'OK'
})

router.post('/request', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    const { host: targetHost, name } = ctx.request.body
    if (targetHost == null) {
        ctx.status = 400
        return
    }
    const keyName = name || host

    const key = await dao.getKey(network, targetHost, keyName)
    if (key == null) {
        await dao.addKey(network, targetHost, keyName, '')
        ctx.body = {
            status: 'pending',
        }
    } else if (key.length < 1) {
        ctx.body = {
            status: 'pending',
        }
    } else {
        ctx.body = {
            status: 'ready',
            key,
        }
    }
})

router.post('/batch_request', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    const reqs = ctx.request.body.map(o => {
        const { host: targetHost, name } = o
        if (targetHost == null) return
        const keyName = name || host
        return { host: targetHost, name: keyName }
    })

    if (reqs.indexOf(null) != -1) {
        ctx.status = 400
        return
    }

    ctx.body = await Promise.all(reqs.map(async r => {
        const { host: targetHost, name } = r
        const key = await dao.getKey(network, targetHost, name)
        if (key == null) {
            await dao.addKey(network, targetHost, name, '')
            return {
                status: 'pending',
            }
        } else if (key.length < 1) {
            return {
                status: 'pending',
            }
        } else {
            return {
                status: 'ready',
                key,
            }
        }
    }))
})

module.exports = router
