import { BaseDaoClass } from "./base-dao";
import getOrCreateLogger from "./base-log";

const logger = getOrCreateLogger("app");

export interface UserInfo {
    uid: number;
    platform: string;
    platform_uid: string;
    uname: string;
}

export interface KeyInfo {
    network: string;
    host: string;
    name: string;
    pubkey: string;
}

export interface NetworkConfig {
    network: string;
    subnet: string;
}

export interface WireGuardLinkConfig {
    network: string;
    host: string;
    name: string;
    address: string;
    mtu: number;
    keepalive: number;
}

export interface TunnelInfo {
    id: number;
    network: string;
    type: number;
    protocol: number;
    host: string;
    listen: number;
    target_host: string;
    target_ip: string;
    target_port: number;
    description: string;
    status: number;
}

export interface TunnelFinalConfig {
    network: string;
    host: string;
    name: string;
    config: string;
    config_hash: string;
}

export interface TunnelMeta {
    network: string;
    host: string;
    ip: string;
    frps_port: number;
    frps_token: string;
    frps_use_kcp: number;
    last_seen: Date;
}

export class DaoClass extends BaseDaoClass {
    async getPlatformUser(platform: string, platformUid: string) {
        const result = await this.query(
            "select * from users where platform=? and platform_uid=?",
            [platform, platformUid]
        );
        if (result.length < 1) {
            return null;
        }
        return result[0];
    }

    async getUserByID(uid: string): Promise<UserInfo | null> {
        const result = await this.query("select * from users where uid=?", [
            uid,
        ]);
        if (result.length < 1) {
            return null;
        }
        return result[0];
    }

    async addOrUpdateKey(
        network: string,
        host: string,
        name: string,
        pubkey: string
    ) {
        await this.query(
            "insert into pubkey(network, host, name, pubkey) values (?, ?, ?, ?) on duplicate key update pubkey=?",
            [network, host, name, pubkey, pubkey]
        );
    }

    async getKey(
        network: string,
        host: string,
        name: string
    ): Promise<string | null> {
        const results = await this.query(
            "select * from pubkey where network=? and host=? and name=?",
            [network, host, name]
        );
        if (results.length < 1) {
            return null;
        }

        return results[0].pubkey;
    }

    async getAllKeys(network: string, host: string): Promise<KeyInfo[]> {
        return await this.query(
            "select * from pubkey where network=? and host=?",
            [network, host]
        );
    }

    async addKey(network: string, host: string, name: string, pubkey: string) {
        await this.query(
            "insert into pubkey(network, host, name, pubkey) values (?, ?, ?, ?)",
            [network, host, name, pubkey]
        );
    }

    async getNetworkConfig(network: string): Promise<NetworkConfig | null> {
        const results = await this.query(
            "select * from config where network=?",
            [network]
        );
        if (results.length < 1) return null;
        return results[0];
    }

    async getAllLinks(
        network: string,
        host: string
    ): Promise<WireGuardLinkConfig[]> {
        return await this.query(
            "select * from wglink where network=? and host=?",
            [network, host]
        );
    }

    async createLink(
        network: string,
        host: string,
        name: string,
        mtu: number,
        keepalive: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cbGetAddress: (results: any[]) => string
    ) {
        const conn = await this.getConnection();
        try {
            await conn.begin();
            const results = await conn.query(
                "select * from wglink where network=? for update",
                [network]
            );
            const address = cbGetAddress(results);
            await conn.query(
                "insert into wglink(network, host, name, address, mtu, keepalive) values (?, ?, ?, ?, ?, ?)",
                [network, host, name, address, mtu, keepalive]
            );
            await conn.commit();
        } finally {
            conn.close();
        }
    }

    async getLink(
        network: string,
        host: string,
        name: string
    ): Promise<WireGuardLinkConfig | null> {
        const results = await this.query(
            "select * from wglink where network=? and host=? and name=?",
            [network, host, name]
        );
        if (results.length < 1) {
            return null;
        }

        return results[0];
    }

    async heartbeatHost(network: string, host: string, ip: string) {
        const results = await this.query(
            "select * from wghost where network=? and host=?",
            [network, host]
        );
        if (results.length > 0 && results[0].static == 1) {
            if (results[0].ip != ip) {
                logger.warn(
                    `static ip mismatch. network: ${network}, host: ${host} expected ${results[0].ip}, got ${ip}`
                );
            }
            return;
        }
        await this.query(
            "insert into wghost(network, host, public_ip) values (?, ?, ?) on duplicate key update public_ip=?, last_seen=now()",
            [network, host, ip, ip]
        );
    }

    async getAllTunnels(
        network: string,
        enabledOnly: boolean
    ): Promise<TunnelInfo[]> {
        if (enabledOnly) {
            return await this.query(
                "select * from tunnel where network=? and status=0",
                [network]
            );
        }

        return await this.query("select * from tunnel where network=?", [
            network,
        ]);
    }

    async createTunnel(
        network: string,
        type: string,
        protocol: string,
        host: string,
        listen: string,
        targetHost: string,
        targetIP: string,
        targetPort: number,
        description: string
    ) {
        await this.query(
            "insert into tunnel(network, type, protocol, host, listen, target_host, target_ip, target_port, description, status) values (?,?,?,?,?,?,?,?,?,?)",
            [
                network,
                type,
                protocol,
                host,
                listen,
                targetHost,
                targetIP,
                targetPort,
                description,
                1,
            ]
        );
    }

    async setTunnelStatus(id: number, enable: boolean) {
        const targetStatus = enable ? 0 : 1;
        await this.query("update tunnel set status=? where id=?", [
            targetStatus,
            id,
        ]);
    }

    async getTunnelById(id: number): Promise<TunnelInfo | null> {
        const result = await this.query("select * from tunnel where id=?", [
            id,
        ]);
        if (result.length < 1) {
            return null;
        }

        return result[0];
    }

    async heartbeatTunnelMeta(network: string, host: string) {
        await this.query(
            "update tunnel_meta set last_seen=now(), update_time=update_time where network=? and host=?",
            [network, host]
        );
    }

    async getAllTunnelMeta(network: string): Promise<TunnelMeta[]> {
        return await this.query("select * from tunnel_meta where network=?", [
            network,
        ]);
    }

    async createTunnelMeta(
        network: string,
        host: string,
        frpsPort: number,
        frpsToken: string
    ) {
        await this.query(
            "insert into tunnel_meta(network, host, frps_port, frps_token) values (?, ?, ?, ?)",
            [network, host, frpsPort, frpsToken]
        );
    }

    async getTunnelMetaByHost(
        network: string,
        host: string
    ): Promise<TunnelMeta | null> {
        const result = await this.query(
            "select * from tunnel_meta where network=? and host=?",
            [network, host]
        );
        if (result.length < 1) {
            return null;
        }

        return result[0];
    }

    async getTunnelConfigByHost(
        network: string,
        host: string
    ): Promise<TunnelFinalConfig[]> {
        return await this.query(
            "select * from tunnel_config where network=? and host=?",
            [network, host]
        );
    }

    async getTunnelConfig(
        network: string,
        host: string,
        name: string
    ): Promise<TunnelFinalConfig | null> {
        const results = await this.query(
            "select * from tunnel_config where network=? and host=? and name=?",
            [network, host, name]
        );
        if (results.length < 1) {
            return null;
        }

        return results[0];
    }
}
