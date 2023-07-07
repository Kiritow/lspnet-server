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

function LoadServiceInfo(ctx) {
    const { 'x-service-token': token } = ctx.headers
    if (token != null) {
        const info = CheckServiceToken(token)
        if (info != null) return info
    }
    
    ctx.status = 403
    return
}

module.exports = {
    logger, dao, influxWriteAPI,
    LoadServiceInfo,
}
