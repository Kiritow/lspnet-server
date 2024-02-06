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

function CheckAuthToken(token) {
    const tokenInfo = CheckServiceToken(token)
    if (tokenInfo != null && tokenInfo.data.type == 'auth') {
        return tokenInfo.data
    }

    return null
}

function CreateTunnelPullToken(network, host) {
    return CreateServiceToken({
        type: 'tunnel',
        network,
        host,
    }, 180 * 86400)
}

function CheckTunnelPullToken(token) {
    const tokenInfo = CheckServiceToken(token)
    if (tokenInfo != null && tokenInfo.data.type == 'tunnel') {
        return tokenInfo.data
    }

    return null
}

module.exports = {
    CreateSimpleToken,
    CreateReportToken,
    CreateAuthToken,
    CheckAuthToken,
    CreateTunnelPullToken,
    CheckTunnelPullToken,
}
