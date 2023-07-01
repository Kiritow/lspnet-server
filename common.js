const { CheckServiceToken } = require('./token')
const DaoClass = require('./dao')
const { GetMySQLOptionSync } = require('./credentials')

const logger = require('./base-log')('app')
const dao = new DaoClass(Object.assign(GetMySQLOptionSync(), {
    connectionLimit: 5,
}), require('./base-log')('mysql', {
    level: 'debug',
}))

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
    logger, dao,
    LoadServiceInfo,
}
