import crypto from "crypto";
import { logger, dao } from "./common";
import { TunnelInfo } from "dao";

function getStringHash(s: string) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

interface FRPProxyConfig {
    name: string;
    type: string;
    remotePort: number;
    localIP?: string;
    localPort?: number;
}

function tunnelConfigTofrpProxyConfig(
    tunnelConfig: TunnelInfo
): FRPProxyConfig {
    const realType =
        {
            0: "tcp",
            1: "udp",
            2: "tcp",
        }[tunnelConfig.protocol] || "tcp";

    const config: FRPProxyConfig = {
        name: `tunnel-${tunnelConfig.id}`,
        type: realType,
        remotePort: tunnelConfig.listen,
    };

    if (tunnelConfig.protocol != 2) {
        config.localIP = tunnelConfig.target_ip;
        config.localPort = tunnelConfig.target_port;
    }

    return config;
}

function tunnelConfigToGostArgs(
    tunnelConfig: TunnelInfo,
    targetIP: string
): string[] {
    const realType =
        {
            0: "tcp",
            1: "udp",
            2: "tcp",
        }[tunnelConfig.protocol] || "tcp";

    return [
        "-L",
        `${realType}://:${tunnelConfig.listen}/${targetIP}:${tunnelConfig.target_port}`,
    ];
}

interface IncomingTunnelConfig {
    frps: string | null;
    frpc: string[];
    gost: string[];
}

export async function refreshTunnelConfig(
    network: string,
    configMap: Map<string, IncomingTunnelConfig>
) {
    const conn = await dao.getConnection();
    try {
        await conn.begin();
        await conn.query("delete from tunnel_config where network=?", [
            network,
        ]);
        await Promise.all(
            Array.from(configMap.keys()).map(async (host) => {
                const frpsConfig = configMap.get(host)?.frps;
                if (frpsConfig != null) {
                    const hash = getStringHash(frpsConfig);
                    await conn.query(
                        "insert into tunnel_config(network, host, name, config, config_hash) values (?, ?, ?, ?, ?)",
                        [network, host, `frps-${host}`, frpsConfig, hash]
                    );
                }

                const frpcConfigs = configMap.get(host)?.frpc;
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

                const gostConfigs = configMap.get(host)?.gost;
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

export async function BuildConfigForNetwork(network: string) {
    const allTunnels = await dao.getAllTunnels(network, true);
    const allTunnelMeta = await dao.getAllTunnelMeta(network);

    const tunnelMetaMap = new Map();
    allTunnelMeta.forEach((row) => {
        tunnelMetaMap.set(row.host, row);
    });

    const newConfigMap = new Map<string, IncomingTunnelConfig>();
    const getOrCreateConfig = (host: string) => {
        const config = newConfigMap.get(host);
        if (config !== undefined) {
            return config;
        }

        const newConfig = {
            frps: null,
            frpc: [],
            gost: [],
        };
        newConfigMap.set(host, newConfig);
        return newConfig;
    };

    // frp tunnels
    for (let i = 0; i < allTunnels.length; i++) {
        const tunnelConfig = allTunnels[i];
        if (tunnelConfig.type != 0) continue;

        const meta = tunnelMetaMap.get(tunnelConfig.host);
        if (!meta) {
            logger.warn(
                `skip frps host: ${tunnelConfig.host}, no ip specified`
            );
            continue;
        }

        // `target_host`(frpc) --> `host` (frps)
        getOrCreateConfig(tunnelConfig.target_host).frpc.push(
            JSON.stringify({
                serverAddr: meta.ip,
                serverPort: meta.frps_port,
                auth: {
                    token: meta.frps_token,
                },
                proxies: [tunnelConfigTofrpProxyConfig(tunnelConfig)],
            })
        );

        getOrCreateConfig(tunnelConfig.host).frps = JSON.stringify({
            bindPort: meta.frps_port,
            auth: {
                token: meta.frps_token,
            },
        });
    }

    // gost tunnels
    for (let i = 0; i < allTunnels.length; i++) {
        const tunnelConfig = allTunnels[i];
        if (tunnelConfig.type != 1) continue;

        if (tunnelConfig.target_ip && tunnelConfig.target_ip != "127.0.0.1") {
            getOrCreateConfig(tunnelConfig.host).gost.push(
                JSON.stringify(
                    tunnelConfigToGostArgs(tunnelConfig, tunnelConfig.target_ip)
                )
            );
            continue;
        }

        const meta = tunnelMetaMap.get(tunnelConfig.target_host);
        if (!meta) {
            logger.warn(
                `skip gost host: ${tunnelConfig.target_host}, no ip specified`
            );
            continue;
        }

        getOrCreateConfig(tunnelConfig.host).gost.push(
            JSON.stringify(tunnelConfigToGostArgs(tunnelConfig, meta.ip))
        );
    }

    console.log(newConfigMap);
    await refreshTunnelConfig(network, newConfigMap);
}

export function BuildConfigForNetworkAsync(network: string) {
    const startTime = new Date();
    BuildConfigForNetwork(network)
        .then(() => {
            const costms = new Date().getTime() - startTime.getTime();
            logger.info(
                `build config success for network: ${network}, cost: ${costms}ms`
            );
        })
        .catch((e) => {
            logger.error(e);
            logger.error(`build config failed for network: ${network}`);
        });
}
