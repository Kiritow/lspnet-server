const { BaseDaoClass } = require('./base-dao')

class DaoClass extends BaseDaoClass {
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
            return
        }
        await this.query('insert into wghost(network, host, public_ip) values (?, ?, ?) on duplicate key update public_ip=?, last_seen=now()', [network, host, ip, ip])
    }
}

module.exports = DaoClass
