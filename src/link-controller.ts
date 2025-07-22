import { NodeConfig } from "./model";
import { dao } from "./common";
import { parseNodeConfig } from "./utils";
import { LinkTemplateUpdataParams } from "./dao";

export async function StartLinkController() {}

export function patchLinkExtraWithTemplateExtra(
    linkExtra: Record<string, unknown>,
    templateExtra: Record<string, unknown>,
    patchMode: "client" | "server"
) {
    if (templateExtra.ospf !== undefined) {
        linkExtra.ospf = templateExtra.ospf;
    }

    if (patchMode === "server") {
        if (templateExtra.multilisten !== undefined) {
            linkExtra.multilisten = templateExtra.multilisten;
        }
    }

    if (patchMode === "client") {
        if (templateExtra.multiport !== undefined) {
            linkExtra.multiport = templateExtra.multiport;
        }
    }

    return linkExtra;
}

export async function runLinkController() {
    const allTemplates = await dao.getAllLinkTemplates();
    const allTemplateIds = allTemplates.map((t) => t.id);
    const allTemplateUsedUDPPorts = new Map<number, Set<number>>(); // TOCTOU problem, not important for now
    allTemplates.forEach((t) => {
        if (t.srcListenPort !== 0) {
            if (!allTemplateUsedUDPPorts.has(t.srcNodeId)) {
                allTemplateUsedUDPPorts.set(t.srcNodeId, new Set());
            }
            allTemplateUsedUDPPorts.get(t.srcNodeId)!.add(t.srcListenPort);
        }

        if (t.dstListenPort !== 0) {
            if (!allTemplateUsedUDPPorts.has(t.dstNodeId)) {
                allTemplateUsedUDPPorts.set(t.dstNodeId, new Set());
            }
            allTemplateUsedUDPPorts.get(t.dstNodeId)!.add(t.dstListenPort);
        }
    });

    for (let i = 0; i < allTemplateIds.length; i++) {
        const templateId = allTemplateIds[i];
        const conn = await dao.getConnection();

        try {
            await conn.begin();
            const template = await dao._lockLinkTemplate(conn, templateId);
            if (template === null) {
                console.log(`Template ${templateId} not found`);
                continue;
            }

            // if template is ready, skip
            if (template.ready) continue;

            // if templata is not enabled, make sure wglinks are also disabled, if any.
            if (!template.enabled) {
                if (template.wgLinkClientId !== 0) {
                    console.log(
                        `Template ${template.id}: Disabling client link ${template.wgLinkClientId} due to link template disabled`
                    );
                    await dao._disableWireGuardLink(
                        conn,
                        template.wgLinkClientId
                    );
                }
                if (template.wgLinkServerId !== 0) {
                    console.log(
                        `Template ${template.id}: Disabling server link ${template.wgLinkServerId} due to link template disabled`
                    );
                    await dao._disableWireGuardLink(
                        conn,
                        template.wgLinkServerId
                    );
                }

                await conn.commit();
                continue;
            }

            // if template is enabled but not ready, check if we can enable it
            let templateUpdateData: LinkTemplateUpdataParams = {};

            const srcNode = await dao._lockNodeInfo(conn, template.srcNodeId);
            if (srcNode === null) {
                console.log(
                    `Template ${template.id}: Source node ${template.srcNodeId} not found`
                );
                continue;
            }
            const dstNode = await dao._lockNodeInfo(conn, template.dstNodeId);
            if (dstNode === null) {
                console.log(
                    `Template ${template.id}: Destination node ${template.dstNodeId} not found`
                );
                continue;
            }

            // TODO: add node status check

            // check if node have configs
            let srcNodeConfig: NodeConfig;
            try {
                srcNodeConfig = parseNodeConfig(srcNode.config);
            } catch (e) {
                console.log(
                    `Template ${template.id}: Source node config is invalid: ${e instanceof Error ? e.message : e}`
                );
                continue;
            }

            let dstNodeConfig: NodeConfig;
            try {
                dstNodeConfig = parseNodeConfig(dstNode.config);
            } catch (e) {
                console.log(
                    `Template ${template.id}: Destination node config is invalid: ${e instanceof Error ? e.message : e}`
                );
                continue;
            }

            if (template.srcWgKeyId === 0) {
                // choose a key from the pool
                const keys = await dao._lockUnusedWireGuardKeys(
                    conn,
                    template.srcNodeId
                );
                if (keys.length < 1) {
                    console.log(
                        `Template ${template.id}: No available wireguard key for src node ${template.srcNodeId}`
                    );
                    continue;
                }

                console.log(
                    `Template ${template.id}: Using wireguard key ${keys[0].id} for src node ${template.srcNodeId}`
                );
                templateUpdateData.srcWgKeyId = keys[0].id;
                await dao._markWireGuardKeyUsed(conn, keys[0].id);
            }

            if (template.dstWgKeyId === 0) {
                // choose a key from the pool
                const keys = await dao._lockUnusedWireGuardKeys(
                    conn,
                    template.dstNodeId
                );
                if (keys.length < 1) {
                    console.log(
                        `Template ${template.id}: No available wireguard key for dst node ${template.dstNodeId}`
                    );
                    continue;
                }

                console.log(
                    `Template ${template.id}: Using wireguard key ${keys[0].id} for dst node ${template.dstNodeId}`
                );
                templateUpdateData.dstWgKeyId = keys[0].id;
                await dao._markWireGuardKeyUsed(conn, keys[0].id);
            }

            const extraConfigForTemplate: Record<string, unknown> = JSON.parse(
                template.extra
            );

            // check destination IP
            let useConnectIP: string;
            if (template.connectIP.length < 1) {
                // server node has EXTERNAL ip...
                if (dstNodeConfig.ip.length > 0 && dstNodeConfig.external) {
                    // use the first IP from the config
                    console.log(
                        `Template ${template.id}: Choose IP from dst node: ${dstNodeConfig.ip}`
                    );

                    extraConfigForTemplate.endpointMode = 1; // resolve at client side, whether it's DDNS or not.
                    extraConfigForTemplate.endpointHost = dstNodeConfig.ip;
                    useConnectIP = dstNodeConfig.ip;
                } else {
                    console.log(
                        `Template ${template.id}: No connect IP and no IP from dst node avaiable`
                    );
                    continue;
                }
            } else {
                useConnectIP = template.connectIP;
            }

            // check destination port
            if (template.dstListenPort === 0) {
                // find a free port
                let selectedUDPPort = 0;
                if (allTemplateUsedUDPPorts.has(template.dstNodeId)) {
                    // some ports might have been used. choose one from the left.
                    const leftPorts = new Set(dstNodeConfig.allowedUDPPorts);
                    allTemplateUsedUDPPorts
                        .get(template.dstNodeId)!
                        .forEach((p) => leftPorts.delete(p));
                    if (leftPorts.size > 0) {
                        selectedUDPPort = Array.from(leftPorts)[0];
                        allTemplateUsedUDPPorts
                            .get(template.dstNodeId)!
                            .add(selectedUDPPort);
                    }
                } else if (dstNodeConfig.allowedUDPPorts.length > 0) {
                    // no ports used, choose one from the config
                    selectedUDPPort = dstNodeConfig.allowedUDPPorts[0];
                    allTemplateUsedUDPPorts.set(
                        dstNode.id,
                        new Set([selectedUDPPort])
                    );
                }

                if (selectedUDPPort === 0) {
                    const nodeUsedPorts = Array.from(
                        allTemplateUsedUDPPorts
                            .get(template.dstNodeId)
                            ?.values() ?? []
                    ).join(",");

                    console.log(
                        `Template ${template.id}: No available UDP port for dst node ${template.dstNodeId}. Used: [${nodeUsedPorts}]`
                    );
                    continue;
                }

                console.log(
                    `Template: ${template.id}: Chosen server UDP port: ${selectedUDPPort}`
                );
                templateUpdateData.dstListenPort = selectedUDPPort;
            }

            // select a subnet
            if (template.subnetId === 0) {
                const subnet = await dao._lockAnySubnet(
                    conn,
                    dstNode.clusterId
                );
                if (subnet === null) {
                    console.log(
                        `Template ${template.id}: No available subnet for cluster ${dstNode.clusterId}`
                    );
                    continue;
                }

                console.log(
                    `Template ${template.id}: Using subnet ${subnet.id} (${subnet.subnetCIDR}) from cluster ${dstNode.clusterId}`
                );
                await dao._markSubnetUsed(conn, subnet.id);
                templateUpdateData.subnetId = subnet.id;
            }

            // update template extra, if any...
            templateUpdateData.extra = JSON.stringify(extraConfigForTemplate);

            // if everything is ok, update to db first...
            await dao._updateLinkTemplate(
                conn,
                template.id,
                templateUpdateData
            );

            // ... then read back
            const updatedTemplate = await dao._lockLinkTemplate(
                conn,
                template.id
            );
            if (updatedTemplate === null) {
                // unlikely
                console.log(
                    `Template ${template.id}: Updated template not found`
                );
                continue;
            }

            // clear and reuse...
            templateUpdateData = {};

            if (updatedTemplate.wgLinkClientId === 0) {
                // create client link
                const clientLinkId = await dao._createWireGuardLink(conn, {
                    nodeId: updatedTemplate.srcNodeId,
                    wgKeyId: updatedTemplate.srcWgKeyId,
                    listenPort: updatedTemplate.srcListenPort,
                    mtu: updatedTemplate.mtu,
                    subnetId: updatedTemplate.subnetId,
                    type: 0, // client
                    peerNodeId: updatedTemplate.dstNodeId,
                    peerPublicKeyId: updatedTemplate.dstWgKeyId,
                    keepalive: 25,
                    endpointMode: 1,
                    endpointTemplate: `${useConnectIP}:${updatedTemplate.dstListenPort}`,
                    endpoint: `${useConnectIP}:${updatedTemplate.dstListenPort}`,
                    extra: JSON.stringify(
                        patchLinkExtraWithTemplateExtra(
                            {
                                templateId,
                            },
                            extraConfigForTemplate,
                            "client"
                        )
                    ),
                    status: 1,
                });

                templateUpdateData.wgLinkClientId = clientLinkId;
            } else {
                // TODO: update client link.
                const clientLink = await dao._lockWireGuardLink(
                    conn,
                    updatedTemplate.wgLinkClientId
                );
                if (clientLink === null) {
                    console.log(
                        `Template ${template.id}: Client link ${updatedTemplate.wgLinkClientId} not found`
                    );
                    continue;
                }

                // sync listen port, endpoint, extra
                const clientLinkExtra = patchLinkExtraWithTemplateExtra(
                    JSON.parse(clientLink.extra),
                    extraConfigForTemplate,
                    "client"
                );

                await dao._updateWireGuardLink(
                    conn,
                    updatedTemplate.wgLinkClientId,
                    {
                        listenPort: updatedTemplate.srcListenPort,
                        endpointMode: 1,
                        endpointTemplate: `${useConnectIP}:${updatedTemplate.dstListenPort}`,
                        endpoint: `${useConnectIP}:${updatedTemplate.dstListenPort}`,
                        extra: JSON.stringify(clientLinkExtra),
                    }
                );
            }

            if (updatedTemplate.wgLinkServerId === 0) {
                const serverLinkId = await dao._createWireGuardLink(conn, {
                    nodeId: updatedTemplate.dstNodeId,
                    wgKeyId: updatedTemplate.dstWgKeyId,
                    listenPort: updatedTemplate.dstListenPort,
                    mtu: updatedTemplate.mtu,
                    subnetId: updatedTemplate.subnetId,
                    type: 1, // server
                    peerNodeId: updatedTemplate.srcNodeId,
                    peerPublicKeyId: updatedTemplate.srcWgKeyId,
                    keepalive: 0,
                    endpointMode: 0,
                    endpointTemplate: "",
                    endpoint: "",
                    extra: JSON.stringify(
                        patchLinkExtraWithTemplateExtra(
                            {
                                templateId,
                            },
                            extraConfigForTemplate,
                            "server"
                        )
                    ),
                    status: 1,
                });

                templateUpdateData.wgLinkServerId = serverLinkId;
            } else {
                // TODO: update server link.
                // sync extra
                const serverLink = await dao._lockWireGuardLink(
                    conn,
                    updatedTemplate.wgLinkServerId
                );
                if (serverLink === null) {
                    console.log(
                        `Template ${template.id}: Server link ${updatedTemplate.wgLinkServerId} not found`
                    );
                    continue;
                }

                const serverLinkExtra = patchLinkExtraWithTemplateExtra(
                    JSON.parse(serverLink.extra),
                    extraConfigForTemplate,
                    "server"
                );

                await dao._updateWireGuardLink(
                    conn,
                    updatedTemplate.wgLinkServerId,
                    {
                        listenPort: updatedTemplate.dstListenPort,
                        extra: JSON.stringify(serverLinkExtra),
                    }
                );
            }

            // mark template as ready
            console.log(`Template ${template.id}: Marking as ready`);
            templateUpdateData.ready = true;

            // update template
            await dao._updateLinkTemplate(
                conn,
                template.id,
                templateUpdateData,
                {
                    lastCheck: true,
                    lastSync: true,
                }
            );

            await conn.commit();
        } catch (e) {
            console.log(e);
            console.log(`Error processing template ${templateId}: ${e}`);
        } finally {
            conn.finish();
        }
    }
}
