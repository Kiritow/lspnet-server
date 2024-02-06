const { CheckServiceToken } = require('./token')
const DaoClass = require('./dao')
const { GetMySQLOptionSync, GetInfluxDBOptionSync } = require('./credentials')
const { InfluxDB, Point } = require('@influxdata/influxdb-client')
const InfluxAPI = require('./influx')

const logger = require('./base-log')('app')
const dao = new DaoClass(Object.assign(GetMySQLOptionSync(), {
    connectionLimit: 5,
}), require('./base-log')('mysql', {
    level: 'debug',
}))

const influxDBOptions = GetInfluxDBOptionSync()
const influxDBClient = new InfluxDB({
    url: influxDBOptions.url,
    token: influxDBOptions.token,
})
const influxWriteAPI = new InfluxAPI(influxDBClient, influxDBOptions.org, influxDBOptions.bucket)

function CheckServiceTokenWithType(token, allowedTypes) {
    const tokenInfo = CheckServiceToken(token)
    if (tokenInfo != null) {
        const tokenData = tokenInfo.data
        if (allowedTypes == null || allowedTypes.length < 1 || allowedTypes.indexOf(tokenData.type) != -1) {
            return tokenData
        }
    }

    return null
}

function GetRequestToken(ctx) {
    const { 'x-service-token': token } = ctx.headers
    return token
}

function LoadServiceInfo(ctx, allowedTypes) {
    const realAllowedTypes = allowedTypes || ["simple"]

    const token = GetRequestToken(ctx)
    if (token != null) {
        const tokenData = CheckServiceTokenWithType(token, realAllowedTypes)
        if (tokenData != null) {
            return tokenData
        }

        ctx.status = 403
        return
    }

    ctx.status = 401
    return
}

module.exports = {
    logger, dao, influxWriteAPI,
    GetRequestToken,
    LoadServiceInfo,
    CheckServiceTokenWithType,
}
