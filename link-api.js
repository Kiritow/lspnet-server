const koaRouter = require('koa-router')
const { logger, dao, LoadServiceInfo } = require('./common')
const { Address4 } = require('ip-address')
const { BigInteger } = require('jsbn')
const { influxWriteAPI } = require('./common')


function IsValidLinkCIDR(cidr) {
    try {
        const addr = new Address4(cidr)
        return addr.subnetMask == 30
    } catch (e) {
        return false
    }
}

function GetPeerLinkCIDR(cidr) {
    if (!IsValidLinkCIDR(cidr)) return null
    const addr = new Address4(cidr)
    const usedAddress = BigInt(addr.bigInteger().toString())
    const linkNetworkAddressMin = BigInt(addr.startAddress().bigInteger().toString())
    const nextAddress = usedAddress == linkNetworkAddressMin + 1n ? linkNetworkAddressMin + 2n : linkNetworkAddressMin + 1n
    return `${Address4.fromBigInteger(new BigInteger(nextAddress.toString())).address}/30`
}

function GetNextAvailableLinkNetworkCIDR(cidrArray, subnetCIDR) {
    const subnetAddressMin = BigInt(new Address4(subnetCIDR).startAddress().bigInteger().toString())
    const subnetAddressMax = BigInt(new Address4(subnetCIDR).endAddress().bigInteger().toString())

    let maxNetworkAddress = 0n

    for (let i=0; i<cidrArray.length; i++) {
        if (!IsValidLinkCIDR(cidrArray[i])) {
            logger.warn(`address: ${cidrArray[i]} is not a valid link CIDR, skipping`)
            continue
        }

        const addr = new Address4(cidrArray[i])
        const networkAddress = BigInt(addr.startAddress().bigInteger().toString())

        if (networkAddress < subnetAddressMin || networkAddress > subnetAddressMax) {
            logger.warn(`address: ${cidrArray[i]} is not in subnet: ${subnetCIDR}, skipping`)
            continue
        }

        if (networkAddress > maxNetworkAddress) {
            maxNetworkAddress = networkAddress
        }
    }

    if (maxNetworkAddress == 0n) {
        maxNetworkAddress = subnetAddressMin
    }

    const nextNetworkAddress = maxNetworkAddress + 4n
    return `${Address4.fromBigInteger(new BigInteger(nextNetworkAddress.toString())).address}/30`
}

function IsSubnetOverlapped(cidrArray, subnetCIDR) {
    const subnetAddressMin = BigInt(new Address4(subnetCIDR).startAddress().bigInteger().toString())
    const subnetAddressMax = BigInt(new Address4(subnetCIDR).endAddress().bigInteger().toString())

    for (let i=0; i<cidrArray.length; i++) {
        const cidrAddressMin = BigInt(new Address4(cidrArray[i]).startAddress().bigInteger().toString())
        const cidrAddressMax = BigInt(new Address4(cidrArray[i]).endAddress().bigInteger().toString())

        if (cidrAddressMin <= subnetAddressMax || cidrAddressMax >= subnetAddressMin) {
            return true
        }
    }

    return false
}

const router = new koaRouter({
    prefix: '/link',
})

router.get('/list', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo

    const results = await dao.getAllLinks(network, host)
    if (results == null) {
        ctx.body = {}
        return
    }

    const data = {}
    results.forEach(row => data[row.name] = row)
    ctx.body = data
})

router.post('/create', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo
    const { name, address, mtu, keepalive } = ctx.request.body
    if (name == null) {
        ctx.status = 400
        return
    }

    if (address != null && !IsValidLinkCIDR(address)) {
        ctx.status = 400
        ctx.body = 'invalid link address'
        return
    }

    const networkConfig = await dao.getNetworkConfig(network)
    if (networkConfig == null) {
        ctx.status = 400
        ctx.body = 'invalid network'
        return
    }

    const realMTU = parseInt(mtu, 10) || 1420
    const realKeepalive = parseInt(keepalive, 10) || 0

    await dao.createLink(network, host, name, realMTU, realKeepalive, (results) => {
        // Find reverse link first
        for (let i=0; i<results.length; i++) {
            if (results[i].name == host && results[i].host == name) {
                const peerCIDR = GetPeerLinkCIDR(results[i].address)
                if (peerCIDR == null) {
                    throw Error(`unable to get peer link cidr from ${results[i].address}`)
                }
                return peerCIDR
            }
        }

        if (address != null) {
            if (!IsSubnetOverlapped(results.map(row => row.address), address)) return address

            logger.warn(`address ${address} overlapped with existing subnets, skipped`)
        }

        const nextCIDR = GetNextAvailableLinkNetworkCIDR(results.map(row => row.address), networkConfig.subnet)
        logger.info(`choose next cidr: ${nextCIDR}`)
        return GetPeerLinkCIDR(nextCIDR)
    })

    ctx.body = await dao.getLink(network, host, name)
})

router.post('/report', async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx)
    if (serviceInfo == null) return

    const { network, host } = serviceInfo
    const { name, ping, rx, tx } = ctx.request.body
    if (name == null) {
        ctx.status = 400
        return
    }

    const realPing = parseInt(ping, 10) || null
    const realRx = parseInt(rx, 10) || null
    const realTx = parseInt(tx, 10) || null

    const dataPack = {
        rx: realRx,
        tx: realTx,
        ping: realPing,
    }

    Object.keys(dataPack).forEach(k => {
        if (dataPack[k] == null) {
            delete dataPack[k]
        }
    })

    influxWriteAPI.writeMultiInt('inf.network.monitoring', dataPack, { network, host, name })
    await influxWriteAPI.flush()

    // Use cloudflare client ip header first
    const clientIP = `${ctx.headers['CF-Connecting-IP'] || ctx.request.ip}`
    await dao.heartbeatHost(network, host, clientIP)

    ctx.body = 'OK'
})

module.exports = router
