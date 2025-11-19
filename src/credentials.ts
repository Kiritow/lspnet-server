import fs from "fs";
import z from "zod";

export function GetMySQLOptionSync() {
    return z
        .object({
            host: z.string(),
            port: z.number(),
            user: z.string(),
            password: z.string(),
            database: z.string(),
        })
        .parse(
            JSON.parse(
                fs.readFileSync("mysql.secret", {
                    encoding: "utf-8",
                })
            )
        );
}

export function GetServiceTokenKeysSync() {
    return z
        .string()
        .array()
        .parse(
            JSON.parse(
                fs.readFileSync("service_token.secret", {
                    encoding: "utf-8",
                })
            )
        );
}

export function GetInfluxDBOptionSync() {
    return z
        .object({
            url: z.string(),
            token: z.string(),
            org: z.string(),
            bucket: z.string(),
        })
        .parse(
            JSON.parse(
                fs.readFileSync("influxdb.secret", {
                    encoding: "utf-8",
                })
            )
        );
}

export function GetGithubOAuthAppSync() {
    return z
        .object({
            id: z.string(),
            secret: z.string(),
        })
        .parse(
            JSON.parse(
                fs.readFileSync("oauth_github.secret", {
                    encoding: "utf-8",
                })
            )
        );
}

export function GetKoaAppSecretSync() {
    return z
        .string()
        .array()
        .parse(
            JSON.parse(
                fs.readFileSync("koa.secret", {
                    encoding: "utf-8",
                })
            )
        );
}
