const { CreateServiceToken, CheckServiceToken } = require('./token')

function CreateSimpleToken(network, host) {
    return CreateServiceToken({
        type: 'simple',
        host,
        network,
    }, 3600)
}

function CreateReportToken(network, host) {
    return CreateServiceToken({
        type: 'report',
        host,
        network,
    }, 365 * 86400)
}

// for CLI tools to authenticate
function CreateAuthToken() {
    return CreateServiceToken({
        type: 'auth',
    }, 180)
}

module.exports = {
    CreateSimpleToken,
    CreateReportToken,
    CreateAuthToken,
}