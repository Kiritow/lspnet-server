const fs = require('fs')

function GetMySQLOptionSync() {
    return JSON.parse(fs.readFileSync('mysql.secret', {
        encoding: 'utf-8'
    }))
}

function GetRedisOptionSync() {
    return JSON.parse(fs.readFileSync('redis.secret', {
        encoding: 'utf-8'
    }))
}

function GetServiceTokenKeysSync() {
    return JSON.parse(fs.readFileSync('service_token.secret', {
        encoding: 'utf-8',
    }))
}

function GetInfluxDBOptionSync() {
    return JSON.parse(fs.readFileSync('influxdb.secret', {
        encoding: 'utf-8',
    }))
}

module.exports = { 
    GetMySQLOptionSync,
    GetRedisOptionSync,
    GetServiceTokenKeysSync,
    GetInfluxDBOptionSync,
}
