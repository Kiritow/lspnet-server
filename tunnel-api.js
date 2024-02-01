const koaRouter = require('koa-router')
const crypto = require('crypto')
const { logger, dao, LoadServiceInfo } = require('./common')

const router = new koaRouter({
    prefix: '/tunnel',
})

function tunnelConfigTofrpProxyConfig(tunnelConfig) {
    const realType = {
        0: 'tcp',
        1: 'udp',
        2: 'tcp',
    }[tunnelConfig.protocol] || 'tcp'

    const config = {
        name: `tunnel-${tunnelConfig.id}`,
        type: realType,
        remotePort: tunnelConfig.listen,
    }

    if (tunnelConfig.protocol != 2) {
        config.localIP = tunnelConfig.target_ip
        config.localPort = tunnelConfig.target_port
    }

    return config
}

function tunnelConfigToGostArgs(tunnelConfig, targetIP) {
    const realType = {
        0: 'tcp',
        1: 'udp',
        2: 'tcp',
    }[tunnelConfig.protocol] || 'tcp'

    return ['-L', `${realType}://:${tunnelConfig.listen}/${targetIP}:${tunnelConfig.target_port}`]
}

async function BuildConfigForNetwork(network) {
    const allTunnels = await dao.getAllTunnels(network)
    const allTunnelMeta = await dao.getAllTunnelMeta(network)

    const tunnelMetaMap = new Map()
    allTunnelMeta.forEach(row => {
        tunnelMetaMap.set(row.host, row)
    })

    const ensureTunnelMeta = async (host) => {
        if (!tunnelMetaMap.has(host)) {
            const newToken = crypto.randomBytes(128).toString('base64')
            await dao.createTunnelMeta(network, host, newToken)

            tunnelMetaMap.set(host, {
                frps_token: newToken,
                frps_port: 7000,
            })
        }
    }

    const newConfigMap = new Map()
    const initNewConfig = (host) => {
        if (!newConfigMap.has(host)) {
            newConfigMap.set(host, {
                frps: null,
                frpc: [],
                gost: [],
            })
        }
    }

    // frp tunnels
    for(let i=0; i<allTunnels.length; i++) {
        const tunnelConfig = allTunnels[i]
        if (tunnelConfig.type != 0) continue

        await ensureTunnelMeta(tunnelConfig.host)
        const meta = tunnelMetaMap.get(tunnelConfig.host)

        if (meta.ip == '') {
            logger.warn(`skip frps host: ${tunnelConfig.host}, no ip specified`)
            continue
        }

        // `target_host`(frpc) --> `host` (frps)
        initNewConfig(tunnelConfig.target_host)
        newConfigMap.get(tunnelConfig.target_host).frpc.push(JSON.stringify({
            serverAddr: meta.ip,
            serverPort: meta.frps_port,
            auth: {
                token: meta.frps_token,
            },
            proxies: [tunnelConfigTofrpProxyConfig(tunnelConfig)],
        }))

        initNewConfig(tunnelConfig.host)
        newConfigMap.get(tunnelConfig.host).frps = JSON.stringify({
            bindPort: meta.frps_port,
            auth: {
                token: meta.frps_token,
            }
        })
    }

    // gost tunnels
    for (let i=0; i<allTunnels.length; i++) {
        const tunnelConfig = allTunnels[i]
        if (tunnelConfig.type != 1) continue

        if (tunnelConfig.target_ip && tunnelConfig.target_ip != '127.0.0.1') {
            initNewConfig(tunnelConfig.host)
            newConfigMap.get(tunnelConfig.host).gost.push(JSON.stringify(tunnelConfigToGostArgs(tunnelConfig, tunnelConfig.target_ip)))
            continue
        }

        await ensureTunnelMeta(tunnelConfig.target_host)
        const meta = tunnelMetaMap.get(tunnelConfig.target_host)

        if (meta.ip == '') {
            logger.warn(`skip gost host: ${tunnelConfig.target_host}, no ip specified`)
            continue
        }

        initNewConfig(tunnelConfig.host)
        newConfigMap.get(tunnelConfig.host).gost.push(JSON.stringify(tunnelConfigToGostArgs(tunnelConfig, meta.ip)))
    }

    console.log(newConfigMap)
    await dao.refreshTunnelConfig(network, newConfigMap)
}

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

module.exports = router
