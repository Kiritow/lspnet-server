import crypto from "crypto";
import { BaseDaoClass } from "./base-dao";
import getOrCreateLogger from "./base-log";

const logger = getOrCreateLogger("app");

function getStringHash(s: string) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

export interface TunnelConfig {
    frps: string | null;
    frpc: string[];
    gost: string[];
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

    async getUserByID(uid: string) {
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

    async getKey(network: string, host: string, name: string) {
        const results = await this.query(
            "select * from pubkey where network=? and host=? and name=?",
            [network, host, name]
        );
        if (results.length < 1) {
            return null;
        }

        return results[0].pubkey;
    }

    async getAllKeys(network: string, host: string) {
        const results = await this.query(
            "select * from pubkey where network=? and host=?",
            [network, host]
        );
        if (results.length < 1) {
            return null;
        }

        return results;
    }

    async addKey(network: string, host: string, name: string, pubkey: string) {
        await this.query(
            "insert into pubkey(network, host, name, pubkey) values (?, ?, ?, ?)",
            [network, host, name, pubkey]
        );
    }

    async getNetworkConfig(network: string) {
        const results = await this.query(
            "select * from config where network=?",
            [network]
        );
        if (results.length < 1) return null;
        return results[0];
    }

    async getAllLinks(network: string, host: string) {
        const results = await this.query(
            "select * from wglink where network=? and host=?",
            [network, host]
        );
        if (results.length < 1) {
            return null;
        }

        return results;
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

    async getLink(network: string, host: string, name: string) {
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

    async getAllTunnels(network: string, enabledOnly: boolean) {
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

    async getTunnelById(id: number) {
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

    async getAllTunnelMeta(network: string) {
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

    async getTunnelMetaByHost(network: string, host: string) {
        const result = await this.query(
            "select * from tunnel_meta where network=? and host=?",
            [network, host]
        );
        if (result.length < 1) {
            return null;
        }

        return result[0];
    }

    async refreshTunnelConfig(
        network: string,
        newConfigMap: Map<string, TunnelConfig>
    ) {
        const conn = await this.getConnection();
        try {
            await conn.begin();
            await conn.query("delete from tunnel_config where network=?", [
                network,
            ]);
            await Promise.all(
                Array.from(newConfigMap.keys()).map(async (host) => {
                    const frpsConfig = newConfigMap.get(host)?.frps;
                    if (frpsConfig != null) {
                        const hash = getStringHash(frpsConfig);
                        await conn.query(
                            "insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)",
                            [network, host, `frps-${host}`, frpsConfig, hash]
                        );
                    }

                    const frpcConfigs = newConfigMap.get(host)?.frpc;
                    if (frpcConfigs != null) {
                        await Promise.all(
                            frpcConfigs.map(async (configStr, configIndex) => {
                                const hash = getStringHash(configStr);
                                await conn.query(
                                    "insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)",
                                    [
                                        network,
                                        host,
                                        `frpc-${host}-${configIndex + 1}`,
                                        configStr,
                                        hash,
                                    ]
                                );
                            })
                        );
                    }

                    const gostConfigs = newConfigMap.get(host)?.gost;
                    if (gostConfigs != null) {
                        await Promise.all(
                            gostConfigs.map(async (configStr, configIndex) => {
                                const hash = getStringHash(configStr);
                                await conn.query(
                                    "insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)",
                                    [
                                        network,
                                        host,
                                        `gost-${host}-${configIndex + 1}`,
                                        configStr,
                                        hash,
                                    ]
                                );
                            })
                        );
                    }
                })
            );
            await conn.commit();
        } finally {
            conn.close();
        }
    }

    async getTunnelConfigByHost(network: string, host: string) {
        return await this.query(
            "select * from tunnel_config where network=? and host=?",
            [network, host]
        );
    }

    async getTunnelConfig(network: string, host: string, name: string) {
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
