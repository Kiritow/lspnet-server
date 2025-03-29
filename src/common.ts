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

export async function getWebUser(ctx: Context) {
    if (ctx.session == null) {
        return null;
    }

    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        return null;
    }

    const accountInfo = await dao.getUserByID(ctx.session.uid);
    if (accountInfo == null) {
        logger.warn(`invalid uid: ${ctx.session.uid}`);
        return null;
    }

    return accountInfo;
}

export async function mustLogin(ctx: Context) {
    const accountInfo = await getWebUser(ctx);
    if (!accountInfo) {
        ctx.body = {
            message: "user not logged in",
        };
        return;
    }

    return accountInfo;
}
