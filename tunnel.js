const { logger, dao } = require('./common')


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
    const allTunnels = await dao.getAllTunnels(network, true)
    const allTunnelMeta = await dao.getAllTunnelMeta(network)

    const tunnelMetaMap = new Map()
    allTunnelMeta.forEach(row => {
        tunnelMetaMap.set(row.host, row)
    })

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

        const meta = tunnelMetaMap.get(tunnelConfig.host)
        if (!meta) {
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

        const meta = tunnelMetaMap.get(tunnelConfig.target_host)
        if (!meta) {
            logger.warn(`skip gost host: ${tunnelConfig.target_host}, no ip specified`)
            continue
        }

        initNewConfig(tunnelConfig.host)
        newConfigMap.get(tunnelConfig.host).gost.push(JSON.stringify(tunnelConfigToGostArgs(tunnelConfig, meta.ip)))
    }

    console.log(newConfigMap)
    await dao.refreshTunnelConfig(network, newConfigMap)
}

function BuildConfigForNetworkAsync(network) {
    const startTime = new Date()
    BuildConfigForNetwork(network).then(() => {
        const costms = new Date().getTime() - startTime.getTime()
        logger.info(`build config success for network: ${network}, cost: ${costms}ms`)
    }).catch(e => {
        logger.error(e)
        logger.error(`build config failed for network: ${network}`)
    })
}

module.exports = {
    BuildConfigForNetwork,
    BuildConfigForNetworkAsync,
}
