const crypto = require('crypto')
const koaRouter = require('koa-router')
const { CreateAuthToken } = require('./simple-token')

const { logger, dao } = require('./common')
const { BuildConfigForNetworkAsync } = require('./tunnel')

const router = new koaRouter({
    prefix: '/admin',
})

router.get('/', async ctx => {
    // redirect if not logged in
    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        const redirectUri = encodeURIComponent(`https://${ctx.host}/admin`)
        ctx.redirect(`/auth/login/github?service=${redirectUri}`)
        return
    }

    const accountInfo = await dao.getUserByID(ctx.session.uid)
    if (accountInfo == null) {
        logger.warn(`invalid uid: ${ctx.session.uid}`)
        ctx.body = 'invalid user'
        return
    }

    const token = CreateAuthToken()
    ctx.body = {
        username: accountInfo.uname,
        token,
    }
})

router.get('/user', async ctx => {
    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        ctx.body = {
            message: 'user not logged in'
        }
        return
    }

    const accountInfo = await dao.getUserByID(ctx.session.uid)
    if (accountInfo == null) {
        logger.warn(`invalid uid: ${ctx.session.uid}`)
        ctx.body = {
            message: 'invalid user'
        }
        return
    }

    ctx.body = {
        message: 'ok',
        username: accountInfo.uname,
    }
})

function mustLogin(ctx) {
    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        ctx.status = 403
        ctx.body = 'user not logged in'
        return true
    }

    return false
}

router.get('/tunnel/list', async ctx => {
    if (mustLogin(ctx)) return

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
    if (mustLogin(ctx)) return

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
    if (mustLogin(ctx)) return

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
    if (mustLogin(ctx)) return

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
    if (mustLogin(ctx)) return

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
    if (mustLogin(ctx)) return

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
