import assert from "node:assert";
import { spawn } from "node:child_process";
import { Address4 } from "ip-address";
import z from "zod";

import {
    _linkTemplateExtraSchema,
    _nodeConfigSchema,
    NodeRouterInfo,
} from "./model";
import { dao } from "./common";

export function isZodError(e: unknown): e is z.ZodError {
    return e instanceof z.ZodError;
}

export function readableZodError<T>(err: z.ZodError<T>): string {
    return err.errors
        .map((e) => {
            const readablePath = e.path
                .map((p) => {
                    if (typeof p === "number") {
                        return `[${p}]`;
                    }
                    return `.${p}`;
                })
                .join("")
                .substring(1);
            return `${readablePath}: ${e.message}`;
        })
        .join("; ");
}

export function RunCommand(callArgs: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(callArgs[0], callArgs.slice(1));
        child.on("exit", (code) => {
            if (code === 0) return resolve(code);
            return reject(code);
        });
        child.stdout.on("data", (data) => console.log(data.toString()));
        child.stderr.on("data", (data) => console.error(data.toString()));
    });
}

export function GetAllAddressFromLinkNetworkCIDR(networkCIDR: string) {
    const addr = new Address4(networkCIDR);
    assert(
        addr.subnetMask === 30,
        `Invalid LinkCIDR ${networkCIDR} with subnet mask: ${addr.subnetMask}`
    );

    const networkAddressRaw = addr.startAddress().bigInt();
    const firstAddress = Address4.fromBigInt(networkAddressRaw + 1n).address;
    const secondAddress = Address4.fromBigInt(networkAddressRaw + 2n).address;
    return [`${firstAddress}/30`, `${secondAddress}/30`];
}

export function GetAllValidLinkSubnetsFromCIDR(networkCIDR: string) {
    const addr = new Address4(networkCIDR);
    const beginAddr = addr.startAddress().bigInt();
    const endAddr = addr.endAddress().bigInt();
    const subnetCIDRs = [];
    for (let i = beginAddr; i < endAddr; i += 4n) {
        subnetCIDRs.push(`${Address4.fromBigInt(i).address}/30`);
    }
    return subnetCIDRs;
}

export function IsSubnetOverlapped(cidrArray: string[], subnetCIDR: string) {
    const subnetAddressMin = new Address4(subnetCIDR).startAddress().bigInt();
    const subnetAddressMax = new Address4(subnetCIDR).endAddress().bigInt();

    for (let i = 0; i < cidrArray.length; i++) {
        const cidrAddressMin = new Address4(cidrArray[i])
            .startAddress()
            .bigInt();
        const cidrAddressMax = new Address4(cidrArray[i]).endAddress().bigInt();

        if (
            cidrAddressMin <= subnetAddressMax ||
            cidrAddressMax >= subnetAddressMin
        ) {
            return true;
        }
    }

    return false;
}

export function parseNodeConfig(rawConfig: string) {
    try {
        const config = JSON.parse(rawConfig);
        return _nodeConfigSchema.parse(config);
    } catch (e) {
        const errorMessage =
            e instanceof z.ZodError
                ? readableZodError(e)
                : e instanceof Error
                  ? e.message
                  : `${e}`;

        throw new Error(`parse node config error: ${errorMessage}`, {
            cause: e,
        });
    }
}

export function parseLinkTemplateExtra(extra: string) {
    try {
        const jExtra = JSON.parse(extra);
        return _linkTemplateExtraSchema.parse(jExtra);
    } catch (e) {
        const errorMessage =
            e instanceof z.ZodError
                ? readableZodError(e)
                : e instanceof Error
                  ? e.message
                  : `${e}`;

        throw new Error(`parse link template extra error: ${errorMessage}`, {
            cause: e,
        });
    }
}

// routerId (ospf) --> nodeInfo.id
export const routerIdMapCache = new Map<string, number>();
export const routerTelemetryCache: {
    areaRouters: Record<string, NodeRouterInfo[]>;
    otherAsbrs: NodeRouterInfo[];
} = {
    areaRouters: {},
    otherAsbrs: [],
};

async function getRouterLabelForWeb(routerId: string) {
    if (routerIdMapCache.has(routerId)) {
        const nodeId = routerIdMapCache.get(routerId)!;
        const nodeInfo = await dao.getNodeInfoById(nodeId);
        if (nodeInfo !== null) {
            return `${nodeInfo.nodeName} (${routerId})`;
        }
    }

    return routerId;
}

export async function getRouterTelemetryForWeb() {
    const nodes: { id: string; label: string; type: string; color: string }[] =
        [];
    const edges: {
        source: string;
        target: string;
        label: string;
        color: string;
    }[] = [];

    const backboneRouters = routerTelemetryCache.areaRouters["0.0.0.0"];
    if (backboneRouters === undefined) {
        console.warn("no backbone routers found");
        return { nodes: [], edges: [] };
    }

    const nodeMap = new Map<string, { label: string; isInternal: boolean }>();
    const viewMap = new Map<
        string,
        { src: string; dst: string; single: boolean; cost: number }
    >();
    for (const router of backboneRouters) {
        nodeMap.set(router.router_id, {
            label: await getRouterLabelForWeb(router.router_id),
            isInternal: true,
        });

        for (const neighbor of router.routers) {
            nodeMap.set(neighbor.router_id, {
                label: await getRouterLabelForWeb(neighbor.router_id),
                isInternal: true,
            });

            const key = `${router.router_id}-${neighbor.router_id}`;
            const rkey = `${neighbor.router_id}-${router.router_id}`;

            if (
                viewMap.has(rkey) &&
                viewMap.get(rkey)!.cost === neighbor.metric
            ) {
                viewMap.get(rkey)!.single = false;
            } else {
                viewMap.set(key, {
                    src: router.router_id,
                    dst: neighbor.router_id,
                    single: true,
                    cost: neighbor.metric,
                });
            }
        }

        for (const externalRouter of router.xrouters) {
            nodeMap.set(externalRouter.router_id, {
                label: await getRouterLabelForWeb(externalRouter.router_id),
                isInternal: false,
            });

            const key = `${router.router_id}-${externalRouter.router_id}`;
            viewMap.set(key, {
                src: router.router_id,
                dst: externalRouter.router_id,
                single: true,
                cost: externalRouter.metric,
            });
        }
    }

    for (const [routerId, nodeInfo] of nodeMap.entries()) {
        nodes.push({
            id: routerId,
            label: nodeInfo.label,
            type: nodeInfo.isInternal ? "core" : "external",
            color: nodeInfo.isInternal ? "#3b82f6" : "#bba1a1",
        });
    }

    for (const value of viewMap.values()) {
        edges.push({
            source: value.src,
            target: value.dst,
            label: `${value.cost.toFixed(2)} ms`,
            color:
                value.cost >= 100
                    ? "#ef4444"
                    : value.cost >= 50
                      ? "#f59e0b"
                      : "#10b981",
        });
    }

    return { nodes, edges };
}
