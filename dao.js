const crypto = require('crypto')
const { BaseDaoClass } = require('./base-dao')

const logger = require('./base-log')('app')

function getStringHash(s) {
    return crypto.createHash('sha256').update(s).digest('hex')
}

class DaoClass extends BaseDaoClass {
    async getPlatformUser(platform, platformUid) {
        const result = await this.query('select * from users where platform=? and platform_uid=?', [platform, platformUid])
        if (result.length < 1) {
            return null
        }
        return result[0]
    }

    async getUserByID(uid) {
        const result = await this.query('select * from users where uid=?', [uid])
        if (result.length < 1) {
            return null
        }
        return result[0]
    }

    async addOrUpdateKey(network, host, name, pubkey) {
        await this.query('insert into pubkey(network, host, name, pubkey) values (?, ?, ?, ?) on duplicate key update pubkey=?', [network, host, name, pubkey, pubkey])
    }

    async getKey(network, host, name) {
        const results = await this.query('select * from pubkey where network=? and host=? and name=?', [network, host, name])
        if (results.length < 1) {
            return null
        }

        return results[0].pubkey
    }

    async getAllKeys(network, host) {
        const results = await this.query('select * from pubkey where network=? and host=?', [network, host])
        if (results.length < 1) {
            return null
        }

        return results
    }

    async addKey(network, host, name, pubkey) {
        await this.query('insert into pubkey(network, host, name, pubkey) values (?, ?, ?, ?)', [network, host, name, pubkey])
    }

    async getNetworkConfig(network) {
        const results = await this.query('select * from config where network=?', [network])
        if (results.length < 1) return null
        return results[0]
    }

    async getAllLinks(network, host) {
        const results = await this.query('select * from wglink where network=? and host=?', [network, host])
        if (results.length < 1) {
            return null
        }

        return results
    }

    async createLink(network, host, name, mtu, keepalive, cbGetAddress) {
        const conn = await this.getConnection()
        try {
            await conn.begin()
            const results = await conn.query('select * from wglink where network=? for update', [network])
            const address = cbGetAddress(results)
            await conn.query('insert into wglink(network, host, name, address, mtu, keepalive) values (?, ?, ?, ?, ?, ?)', [network, host, name, address, mtu, keepalive])
            await conn.commit()
        } finally {
            conn.close()
        }
    }

    async getLink(network, host, name) {
        const results = await this.query('select * from wglink where network=? and host=? and name=?', [network, host, name])
        if (results.length < 1) {
            return null
        }

        return results[0]
    }

    async heartbeatHost(network, host, ip) {
        const results = await this.query('select * from wghost where network=? and host=?', [network, host])
        if (results.length > 0 && results[0].static == 1) {
            if (results[0].ip != ip) {
                logger.warn(`static ip mismatch. network: ${network}, host: ${host} expected ${results[0].ip}, got ${ip}`)
            }
            return
        }
        await this.query('insert into wghost(network, host, public_ip) values (?, ?, ?) on duplicate key update public_ip=?, last_seen=now()', [network, host, ip, ip])
    }

    async getAllTunnelMeta(network) {
        return await this.query('select * from tunnel_meta where network=?', [network])
    }

    async createTunnelMeta(network, host, frpsToken) {
        await this.query('insert into tunnel_meta(network, host, frps_token) values (?, ?, ?)', [network, host, frpsToken])
    }

    async getAllTunnels(network) {
        return await this.query('select * from tunnel where network=? and status=0', [network])
    }

    async refreshTunnelConfig(network, newConfigMap) {
        const conn = await this.getConnection()
        try {
            await conn.begin()
            await conn.query('delete from tunnel_config where network=?', [network])
            await Promise.all(Array.from(newConfigMap.keys()).map(async host => {
                if (newConfigMap.get(host).frps) {
                    const hash = getStringHash(newConfigMap.get(host).frps)
                    await conn.query('insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)', [network, host, `frps-${host}`, newConfigMap.get(host).frps, hash])
                }

                await Promise.all(newConfigMap.get(host).frpc.map(async (configStr, configIndex) => {
                    const hash = getStringHash(configStr)
                    await conn.query('insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)', [network, host, `frpc-${host}-${configIndex+1}`, configStr, hash])
                }))

                await Promise.all(newConfigMap.get(host).gost.map(async (configStr, configIndex) => {
                    const hash = getStringHash(configStr)
                    await conn.query('insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)', [network, host, `gost-${host}-${configIndex+1}`, configStr, hash])
                }))
            }))
            await conn.commit()
        } finally {
            conn.close()
        }
    }

    async getTunnelConfigByHost(network, host) {
        return await this.query('select * from tunnel_config where network=? and host=?', [network, host])
    }

    async getTunnelConfig(network, host, name) {
        const results = await this.query('select * from tunnel_config where network=? and host=? and name=?', [network, host, name])
        if (results.length < 1) {
            return null
        }

        return results[0]
    }
}

module.exports = DaoClass
