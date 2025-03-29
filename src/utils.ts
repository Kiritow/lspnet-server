import assert from "assert";
import { Address4 } from "ip-address";
import z from "zod";

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
