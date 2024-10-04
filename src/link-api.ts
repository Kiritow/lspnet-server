import koaRouter from "koa-router";
import { logger, dao, LoadServiceInfo } from "./common";
import { Address4 } from "ip-address";
import { BigInteger } from "jsbn";
import { influxWriteAPI } from "./common";
import { WireGuardLinkConfig } from "dao";
import { z } from "zod";

function IsValidLinkCIDR(cidr: string) {
    try {
        const addr = new Address4(cidr);
        return addr.subnetMask == 30;
    } catch (e) {
        console.log(e);
        return false;
    }
}

function GetPeerLinkCIDR(cidr: string) {
    if (!IsValidLinkCIDR(cidr)) return null;
    const addr = new Address4(cidr);
    const usedAddress = BigInt(addr.bigInteger().toString());
    const linkNetworkAddressMin = BigInt(
        addr.startAddress().bigInteger().toString()
    );
    const nextAddress =
        usedAddress == linkNetworkAddressMin + 1n
            ? linkNetworkAddressMin + 2n
            : linkNetworkAddressMin + 1n;
    return `${Address4.fromBigInteger(new BigInteger(nextAddress.toString())).address}/30`;
}

function GetNextAvailableLinkNetworkCIDR(
    cidrArray: string[],
    subnetCIDR: string
) {
    const subnetAddressMin = BigInt(
        new Address4(subnetCIDR).startAddress().bigInteger().toString()
    );
    const subnetAddressMax = BigInt(
        new Address4(subnetCIDR).endAddress().bigInteger().toString()
    );

    let maxNetworkAddress = 0n;

    for (let i = 0; i < cidrArray.length; i++) {
        if (!IsValidLinkCIDR(cidrArray[i])) {
            logger.warn(
                `address: ${cidrArray[i]} is not a valid link CIDR, skipping`
            );
            continue;
        }

        const addr = new Address4(cidrArray[i]);
        const networkAddress = BigInt(
            addr.startAddress().bigInteger().toString()
        );

        if (
            networkAddress < subnetAddressMin ||
            networkAddress > subnetAddressMax
        ) {
            logger.warn(
                `address: ${cidrArray[i]} is not in subnet: ${subnetCIDR}, skipping`
            );
            continue;
        }

        if (networkAddress > maxNetworkAddress) {
            maxNetworkAddress = networkAddress;
        }
    }

    if (maxNetworkAddress == 0n) {
        maxNetworkAddress = subnetAddressMin;
    }

    const nextNetworkAddress = maxNetworkAddress + 4n;
    return `${Address4.fromBigInteger(new BigInteger(nextNetworkAddress.toString())).address}/30`;
}

function IsSubnetOverlapped(cidrArray: string[], subnetCIDR: string) {
    const subnetAddressMin = BigInt(
        new Address4(subnetCIDR).startAddress().bigInteger().toString()
    );
    const subnetAddressMax = BigInt(
        new Address4(subnetCIDR).endAddress().bigInteger().toString()
    );

    for (let i = 0; i < cidrArray.length; i++) {
        const cidrAddressMin = BigInt(
            new Address4(cidrArray[i]).startAddress().bigInteger().toString()
        );
        const cidrAddressMax = BigInt(
            new Address4(cidrArray[i]).endAddress().bigInteger().toString()
        );

        if (
            cidrAddressMin <= subnetAddressMax ||
            cidrAddressMax >= subnetAddressMin
        ) {
            return true;
        }
    }

    return false;
}

export const router = new koaRouter({
    prefix: "/link",
});

router.get("/list", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const results = await dao.getAllLinks(network, host);
    if (results == null) {
        ctx.body = {};
        return;
    }

    ctx.body = results.reduce<{ [key: string]: WireGuardLinkConfig }>(
        (acc, link) => {
            acc[link.name] = link;
            return acc;
        },
        {}
    );
});

router.post("/create", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;

    const body = z
        .object({
            name: z.string(),
            address: z.string().optional(),
            mtu: z.coerce.number().int().optional(),
            keepalive: z.number().int().optional(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { name, address, mtu, keepalive } = body.data;

    if (address !== undefined && !IsValidLinkCIDR(address)) {
        ctx.status = 400;
        ctx.body = "invalid link address";
        return;
    }

    const networkConfig = await dao.getNetworkConfig(network);
    if (networkConfig == null) {
        ctx.status = 400;
        ctx.body = "invalid network";
        return;
    }

    const realMTU = mtu !== undefined ? mtu : 1420;
    const realKeepalive = keepalive !== undefined ? keepalive : 0;

    await dao.createLink(
        network,
        host,
        name,
        realMTU,
        realKeepalive,
        (results) => {
            // Find reverse link first
            for (let i = 0; i < results.length; i++) {
                if (results[i].name == host && results[i].host == name) {
                    const peerCIDR = GetPeerLinkCIDR(results[i].address);
                    if (peerCIDR == null) {
                        throw Error(
                            `unable to get peer link cidr from ${results[i].address}`
                        );
                    }
                    return peerCIDR;
                }
            }

            if (address != null) {
                if (
                    !IsSubnetOverlapped(
                        results.map((row) => row.address),
                        address
                    )
                )
                    return address;

                logger.warn(
                    `address ${address} overlapped with existing subnets, skipped`
                );
            }

            const nextCIDR = GetNextAvailableLinkNetworkCIDR(
                results.map((row) => row.address),
                networkConfig.subnet
            );
            logger.info(`choose next cidr: ${nextCIDR}`);
            const peerLinkCIDR = GetPeerLinkCIDR(nextCIDR);
            if (peerLinkCIDR == null) {
                throw Error(`unable to get peer link cidr from ${nextCIDR}`);
            }
            return peerLinkCIDR;
        }
    );

    ctx.body = await dao.getLink(network, host, name);
});

router.post("/report", async (ctx) => {
    const serviceInfo = LoadServiceInfo(ctx, ["simple", "report"]);
    if (serviceInfo == null) return;

    const { network, host } = serviceInfo;
    const body = z
        .object({
            name: z.string(),
            ping: z.number().int().optional(),
            rx: z.number().int().optional(),
            tx: z.number().int().optional(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { name, ping, rx, tx } = body.data;

    const dataPack: { [key: string]: number } = {};
    if (ping !== undefined) {
        dataPack.ping = ping;
    }
    if (rx !== undefined) {
        dataPack.rx = rx;
    }
    if (tx !== undefined) {
        dataPack.tx = tx;
    }

    influxWriteAPI.writeMultiInt("inf.network.monitoring", dataPack, {
        network,
        host,
        name,
    });
    await influxWriteAPI.flush();

    // Use cloudflare client ip header first
    const clientIP = `${ctx.headers["cf-connecting-ip"] || ctx.request.ip}`;
    await dao.heartbeatHost(network, host, clientIP);

    ctx.body = "OK";
});
