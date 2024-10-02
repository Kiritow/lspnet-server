import fs from "fs";

export function GetMySQLOptionSync() {
    return JSON.parse(
        fs.readFileSync("mysql.secret", {
            encoding: "utf-8",
        })
    );
}

export function GetRedisOptionSync() {
    return JSON.parse(
        fs.readFileSync("redis.secret", {
            encoding: "utf-8",
        })
    );
}

export function GetServiceTokenKeysSync(): string[] {
    return JSON.parse(
        fs.readFileSync("service_token.secret", {
            encoding: "utf-8",
        })
    );
}

export function GetInfluxDBOptionSync() {
    return JSON.parse(
        fs.readFileSync("influxdb.secret", {
            encoding: "utf-8",
        })
    );
}

export function GetGithubOAuthAppSync() {
    return JSON.parse(
        fs.readFileSync("oauth_github.secret", {
            encoding: "utf-8",
        })
    );
}

export function GetKoaAppSecretSync() {
    return JSON.parse(
        fs.readFileSync("koa.secret", {
            encoding: "utf-8",
        })
    );
}
