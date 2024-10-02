import { CreateServiceToken, CheckServiceToken, ServiceTokenDataBase } from "./token";

export function CreateSimpleToken(network: string, host: string) {
    return CreateServiceToken(
        {
            type: "simple",
            host,
            network,
        },
        3600
    );
}

export function CreateReportToken(network: string, host: string) {
    return CreateServiceToken(
        {
            type: "report",
            host,
            network,
        },
        365 * 86400
    );
}

// for CLI tools to authenticate
export function CreateAuthToken() {
    return CreateServiceToken(
        {
            type: "auth",
        },
        180
    );
}

export function CheckAuthToken(token: string): ServiceTokenDataBase | null {
    const tokenInfo = CheckServiceToken(token);
    if (tokenInfo != null && tokenInfo.data.type == "auth") {
        return tokenInfo.data;
    }

    return null;
}

export function CreateTunnelPullToken(network: string, host: string) {
    return CreateServiceToken(
        {
            type: "tunnel",
            network,
            host,
        },
        180 * 86400
    );
}

export function CheckTunnelPullToken(
    token: string
): ServiceTokenDataBase | null {
    const tokenInfo = CheckServiceToken(token);
    if (tokenInfo != null && tokenInfo.data.type == "tunnel") {
        return tokenInfo.data;
    }

    return null;
}
