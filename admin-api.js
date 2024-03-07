const crypto = require('crypto')
const koaRouter = require('koa-router')
const { CreateAuthToken, CreateTunnelPullToken } = require('./simple-token')

const { logger, dao } = require('./common')
const { BuildConfigForNetworkAsync } = require('./tunnel')

const router = new koaRouter({
    prefix: '/admin',
})

router.use(async (ctx, next) => {
    try {
        logger.info(`${ctx.method} ${ctx.URL}`)
        logger.info(ctx.headers)

        const startTime = new Date()
        await next()
        logger.info(`${ctx.method} ${ctx.URL} [${ctx.status}] (${new Date().getTime() - startTime.getTime()}ms)`)
    } catch (e) {
        logger.error(e)

        ctx.status = 500
        ctx.body = {
            message: `server internal error: ${e}`
        }
    }
})

async function getWebUser(ctx) {
    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        return null
    }

    const accountInfo = await dao.getUserByID(ctx.session.uid)
    if (accountInfo == null) {
        logger.warn(`invalid uid: ${ctx.session.uid}`)
        return null
    }

    return accountInfo
}

async function mustLogin(ctx) {
    const accountInfo = await getWebUser(ctx)
    if (!accountInfo) {
        ctx.body = {
            message: 'user not logged in'
        }
        return
    }

    return accountInfo
}

router.get('/user', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    ctx.body = {
        message: 'ok',
        data: {
            username: accountInfo.uname,
        }
    }
})

router.post('/token', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const authToken = CreateAuthToken()
    ctx.body = {
        message: 'ok',
        data: {
            token: authToken,
        }
    }
})

router.post('/tunnel/token', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { network, host } = ctx.request.body
    if (!network || !host) {
        ctx.body = {
            message: 'invalid network or host',
        }
        return
    }

    ctx.body = {
        message: 'ok',
        data: {
            token: CreateTunnelPullToken(network, host),
        },
    }
})

router.get('/tunnel/list', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { network } = ctx.query
    if (!network) {
        ctx.body = {
            message: 'invalid network'
        }
        return
    }
    const allTunnels = await dao.getAllTunnels(network, false)

    ctx.body = {
        message: 'ok',
        data: allTunnels.map(row => ({
            id: row.id,
            network: row.network,
            type: {
                0: 'frp',
                1: 'gost'
            }[row.type],
            protocol: {
                0: 'tcp',
                1: 'udp',
                2: 'http',
            }[row.protocol],
            host: row.host,
            listen: row.listen,
            targetHost: row.target_host,
            targetIP: row.target_ip,
            targetPort: row.target_port,
            description: row.description,
            status: row.status == 0 ? true : false,
        }))
    }
})

router.post('/tunnel/create', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { network, type, protocol, host, listen, targetHost, targetIP, targetPort, description } = ctx.request.body
    const realType = {
        'frp': 0,
        'gost': 1,
    }[type]
    if (realType == null) {
        ctx.body = {
            message: `invalid type: ${type}`
        }
        return
    }

    const realProtocol = {
        'tcp': 0,
        'udp': 1,
        'http': 2,
    }[protocol]
    if (protocol == null) {
        ctx.body = {
            message: `invalid protocol: ${protocol}`
        }
        return
    }

    const realListenPort = parseInt(listen, 10)
    if (!realListenPort) {
        ctx.body = {
            message: `invalid listen port: ${listen}`
        }
        return
    }

    // http proxy does not use target_port
    const realTargetPort = realProtocol != 2 ? parseInt(targetPort, 10) : 0
    if (realProtocol != 2 && !realTargetPort) {
        ctx.body = {
            message: `invalid target port: ${targetPort}`
        }
        return
    }

    if (!network || !host ) {
        ctx.body = {
            message: 'invalid network or host'
        }
        return
    }

    if (realType == 0 && !targetHost) {
        ctx.body = {
            message: 'invalid target host'
        }
        return
    }

    const realNetwork = `${network}`
    const realHost = `${host}`
    const realTargetHost = targetHost ? `${targetHost}` : ''
    const realTargetIP = targetIP ? `${targetIP}` : '127.0.0.1'
    const realDescription = description ?? ''

    if (await dao.getTunnelMetaByHost(realNetwork, realHost) == null) {
        ctx.body = {
            message: `invalid host: ${realHost}`,
        }
        return
    }

    if (realTargetHost != '' && await dao.getTunnelMetaByHost(realNetwork, realTargetHost) == null) {
        ctx.body = {
            message: `invalid host: ${realTargetHost}`,
        }
        return
    }

    await dao.createTunnel(realNetwork, realType, realProtocol, realHost, realListenPort, realTargetHost, realTargetIP, realTargetPort, realDescription)
    BuildConfigForNetworkAsync(realNetwork)

    ctx.body = {
        message: 'ok'
    }
})

router.post('/tunnel/disable', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { id } = ctx.request.body
    const tunnel = await dao.getTunnelById(id)
    if (!tunnel) {
        ctx.body = {
            message: 'invalid tunnel'
        }
        return
    }
    await dao.setTunnelStatus(tunnel.id, false)
    BuildConfigForNetworkAsync(tunnel.network)

    ctx.body = {
        message: 'ok'
    }
})

router.post('/tunnel/enable', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { id } = ctx.request.body
    const tunnel = await dao.getTunnelById(id)
    if (!tunnel) {
        ctx.body = {
            message: 'invalid tunnel'
        }
        return
    }
    await dao.setTunnelStatus(tunnel.id, true)
    BuildConfigForNetworkAsync(tunnel.network)

    ctx.body = {
        message: 'ok'
    }
})

router.get('/host/list', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { network } = ctx.query
    if (!network) {
        ctx.body = {
            message: 'invalid network'
        }
        return
    }

    const allTunnelMeta = await dao.getAllTunnelMeta(network)
    ctx.body = {
        message: 'ok',
        data: allTunnelMeta.map(row => ({
            network: row.network,
            host: row.host,
            ip: row.ip,
            frpsPort: row.frps_port,
        }))
    }
})

router.post('/host/create', async ctx => {
    const accountInfo = await mustLogin(ctx)
    if (!accountInfo) return

    const { network, host, ip, frpsPort } = ctx.request.body
    if (!network || !host ) {
        ctx.body = {
            message: 'invalid network or host'
        }
        return
    }

    if (!ip) {
        ctx.body = {
            message: 'invalid host ip'
        }
        return
    }

    const realPort = parseInt(frpsPort, 10) || 7000
    const newToken = crypto.randomBytes(128).toString('base64')
    await dao.createTunnelMeta(network, host, realPort, newToken)

    ctx.body = {
        message: 'ok'
    }
})

module.exports = router
