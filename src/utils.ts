import assert from "assert";
import { Address4 } from "ip-address";
import z from "zod";
import fs from "fs/promises";
import { spawn } from "node:child_process";

import { _nodeConfigSchema, NodeRouterInfo } from "./model";
import { dao } from "./common";

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
            if (code == 0) return resolve(code);
            return reject(code);
        });
        child.stdout.on("data", (data) => console.log(data.toString()));
        child.stderr.on("data", (data) => console.error(data.toString()));
    });
}

export function GetAllAddressFromLinkNetworkCIDR(networkCIDR: string) {
    const addr = new Address4(networkCIDR);
    assert(
        addr.subnetMask == 30,
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

// routerId (ospf) --> nodeInfo.id
export const routerIdMapCache = new Map<string, number>();
export const routerTelemetryCache: {
    areaRouters: Record<string, NodeRouterInfo[]>;
    otherAsbrs: NodeRouterInfo[];
} = {
    areaRouters: {},
    otherAsbrs: [],
};

export async function renderRouterTelemetryFromCache() {
    const backboneRouters = routerTelemetryCache.areaRouters["0.0.0.0"];
    assert(backboneRouters !== undefined, "no backbone routers found");

    const viewMap = new Map<
        string,
        { src: string; dst: string; single: boolean; cost: number }
    >();
    for (const router of backboneRouters) {
        for (const neighbor of router.routers) {
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
            const key = `${router.router_id}-${externalRouter.router_id}`;
            viewMap.set(key, {
                src: router.router_id,
                dst: externalRouter.router_id,
                single: true,
                cost: externalRouter.metric,
            });
        }
    }

    const allTexts = await Promise.all(
        Array.from(viewMap.values()).map(async (value) => {
            const srcLabel = routerIdMapCache.has(value.src)
                ? `${(await dao.getNodeInfoById(routerIdMapCache.get(value.src)!))?.nodeName} (${value.src})`
                : value.src;
            const dstLabel = routerIdMapCache.has(value.dst)
                ? `${(await dao.getNodeInfoById(routerIdMapCache.get(value.dst)!))?.nodeName} (${value.dst})`
                : value.dst;
            if (value.single) {
                return `"${srcLabel}" -> "${dstLabel}" [label="${value.cost}"];`;
            } else {
                return `"${srcLabel}" -> "${dstLabel}" [label="${value.cost}",dir=none];`;
            }
        })
    );

    const finalText = `digraph ospf {
${allTexts.join("\n")}
}`;

    const tempFilename = `/tmp/ospf-diagram-${Date.now()}.dot`;
    const svgFilename = `/tmp/ospf-diagram-${Date.now()}.svg`;
    await fs.writeFile(tempFilename, finalText);
    await RunCommand([
        "dot",
        "-Ksfdp",
        "-Tsvg",
        tempFilename,
        "-o",
        svgFilename,
    ]);
    await fs.unlink(tempFilename);
    const svgContent = await fs.readFile(svgFilename, "utf-8");
    await fs.unlink(svgFilename);
    return svgContent;
}
