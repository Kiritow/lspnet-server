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

function LoadServiceInfo(ctx, allowedTypes) {
    const realAllowedTypes = allowedTypes || ["simple"]

    const { 'x-service-token': token } = ctx.headers
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

async function LoadUserInfo(ctx) {
    const ss_token = ctx.cookies.get('ss_token')
    if (ss_token == null) {
        return null
    }

    const tokenData = CheckServiceTokenWithType(ss_token, ['user'])
    if (tokenData == null) {
        return null
    }

    const result = await dao.getPlatformUser(tokenData.platform, tokenData.userid)
    if (result == null) {
        logger.error(`platform: ${tokenData.platform} user: ${tokenData.userid} not found`)
        return null
    }

    return result
}

module.exports = {
    logger, dao, influxWriteAPI,
    LoadServiceInfo,
    LoadUserInfo,
    CheckServiceTokenWithType,
}
