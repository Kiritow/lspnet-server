import { BaseDaoClass } from "./base-dao";
import getOrCreateLogger from "./base-log";
import z from "zod";

const logger = getOrCreateLogger("app");

const _userInfoSchema = z.object({
    uid: z.number(),
    platform: z.string(),
    platform_uid: z.string(),
    uname: z.string(),
});

export type UserInfo = z.infer<typeof _userInfoSchema>;

const _keyInfoSchema = z.object({
    network: z.string(),
    host: z.string(),
    name: z.string(),
    pubkey: z.string(),
});

export type KeyInfo = z.infer<typeof _keyInfoSchema>;

const _networkConfigSchema = z.object({
    network: z.string(),
    subnet: z.string(),
});

export type NetworkConfig = z.infer<typeof _networkConfigSchema>;

const _wireGuardLinkConfigSchema = z.object({
    network: z.string(),
    host: z.string(),
    name: z.string(),
    address: z.string(),
    mtu: z.number(),
    keepalive: z.number(),
});

export type WireGuardLinkConfig = z.infer<typeof _wireGuardLinkConfigSchema>;

const _tunnelInfoSchema = z.object({
    id: z.number(),
    network: z.string(),
    type: z.number(),
    protocol: z.number(),
    host: z.string(),
    listen: z.number(),
    target_host: z.string(),
    target_ip: z.string(),
    target_port: z.number(),
    description: z.string(),
    status: z.number(),
});

export type TunnelInfo = z.infer<typeof _tunnelInfoSchema>;

const _tunnelFinalConfigSchema = z.object({
    network: z.string(),
    host: z.string(),
    name: z.string(),
    config: z.string(),
    config_hash: z.string(),
});

export type TunnelFinalConfig = z.infer<typeof _tunnelFinalConfigSchema>;

const _tunnelMetaSchema = z.object({
    network: z.string(),
    host: z.string(),
    ip: z.string(),
    frps_port: z.number(),
    frps_token: z.string(),
    frps_use_kcp: z.number(),
    last_seen: z.date(),
});

export type TunnelMeta = z.infer<typeof _tunnelMetaSchema>;

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
        return _userInfoSchema.parse(result[0]);
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

        return _keyInfoSchema.parse(results[0]).pubkey;
    }

    async getAllKeys(network: string, host: string): Promise<KeyInfo[]> {
        const result = await this.query(
            "select * from pubkey where network=? and host=?",
            [network, host]
        );
        return result.map((row) => _keyInfoSchema.parse(row));
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
        return _networkConfigSchema.parse(results[0]);
    }

    async getAllLinks(
        network: string,
        host: string
    ): Promise<WireGuardLinkConfig[]> {
        const results = await this.query(
            "select * from wglink where network=? and host=?",
            [network, host]
        );

        return results.map((row) => _wireGuardLinkConfigSchema.parse(row));
    }

    async createLink(
        network: string,
        host: string,
        name: string,
        mtu: number,
        keepalive: number,
        cbGetAddress: (results: WireGuardLinkConfig[]) => string
    ) {
        const conn = await this.getConnection();
        try {
            await conn.begin();
            const results = await conn.query(
                "select * from wglink where network=? for update",
                [network]
            );
            const links = results.map((row) =>
                _wireGuardLinkConfigSchema.parse(row)
            );
            const address = cbGetAddress(links);
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

        return _wireGuardLinkConfigSchema.parse(results[0]);
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
            const results = await this.query(
                "select * from tunnel where network=? and status=0",
                [network]
            );
            return results.map((row) => _tunnelInfoSchema.parse(row));
        }

        const results = await this.query(
            "select * from tunnel where network=?",
            [network]
        );
        return results.map((row) => _tunnelInfoSchema.parse(row));
    }

    async createTunnel(
        network: string,
        type: number,
        protocol: number,
        host: string,
        listen: number,
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

        return _tunnelInfoSchema.parse(result[0]);
    }

    async heartbeatTunnelMeta(network: string, host: string) {
        await this.query(
            "update tunnel_meta set last_seen=now(), update_time=update_time where network=? and host=?",
            [network, host]
        );
    }

    async getAllTunnelMeta(network: string): Promise<TunnelMeta[]> {
        const results = await this.query(
            "select * from tunnel_meta where network=?",
            [network]
        );

        return results.map((row) => _tunnelMetaSchema.parse(row));
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

        return _tunnelMetaSchema.parse(result[0]);
    }

    async getTunnelConfigByHost(
        network: string,
        host: string
    ): Promise<TunnelFinalConfig[]> {
        const result = await this.query(
            "select * from tunnel_config where network=? and host=?",
            [network, host]
        );
        return result.map((row) => _tunnelFinalConfigSchema.parse(row));
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

        return _tunnelFinalConfigSchema.parse(results[0]);
    }
}
