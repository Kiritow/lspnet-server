import { CheckServiceToken } from "./token";
import { DaoClass } from "./dao";
import { GetMySQLOptionSync, GetInfluxDBOptionSync } from "./credentials";
import getOrCreateLogger from "./base-log";
import { InfluxDB } from "@influxdata/influxdb-client";
import { InfluxAPI } from "./influx";
import { Context } from "koa";

export const logger = getOrCreateLogger("app");
export const dao = new DaoClass(
    Object.assign(GetMySQLOptionSync(), {
        connectionLimit: 5,
    }),
    getOrCreateLogger("mysql", {
        level: "debug",
    })
);

const influxDBOptions = GetInfluxDBOptionSync();
const influxDBClient = new InfluxDB({
    url: influxDBOptions.url,
    token: influxDBOptions.token,
});

export const influxWriteAPI = new InfluxAPI(
    influxDBClient,
    influxDBOptions.org,
    influxDBOptions.bucket
);

export function CheckServiceTokenWithType(
    token: string,
    allowedTypes: string[]
) {
    const tokenInfo = CheckServiceToken(token);
    if (tokenInfo != null) {
        const tokenData = tokenInfo.data;
        if (
            allowedTypes == null ||
            allowedTypes.length < 1 ||
            allowedTypes.indexOf(tokenData.type) != -1
        ) {
            return tokenData;
        }
    }

    return null;
}

export function GetRequestToken(ctx: Context): string {
    const { "x-service-token": token } = ctx.headers;
    switch (typeof token) {
        case "string":
            return token;
        case "object":
            return token[0];
        default:
            return "";
    }
}

export function LoadServiceInfo(ctx: Context, allowedTypes: string[]) {
    const realAllowedTypes = allowedTypes || ["simple"];

    const token = GetRequestToken(ctx);
    if (token != null) {
        const tokenData = CheckServiceTokenWithType(token, realAllowedTypes);
        if (tokenData != null) {
            return tokenData;
        }

        ctx.status = 403;
        return;
    }

    ctx.status = 401;
    return;
}
