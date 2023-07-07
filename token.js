const crypto = require('crypto')
const { GetServiceTokenKeysSync } = require('./credentials')

// Generate new key with crypto.randomBytes(32).toString('hex')
const serviceKeys = GetServiceTokenKeysSync().map(k => Buffer.from(k, 'hex'))

function CreateServiceToken(data, expireSeconds) {
    if (data == null) throw Error('token data cannot be null')

    const tokenData = {
        data,
        iat: Math.floor(new Date().getTime() / 1000),
        exp: Math.floor(new Date().getTime() / 1000) + expireSeconds,
    }

    const realData = Buffer.from(JSON.stringify(tokenData), 'utf-8')
    const iv = crypto.randomBytes(16)
    const keyIndex = Math.floor(Math.random() * serviceKeys.length)
    const key = serviceKeys[keyIndex]

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const resultBuffer = Buffer.concat([cipher.update(realData), cipher.final()])
    const authTag = cipher.getAuthTag()

    return `${resultBuffer.toString('base64')}.${keyIndex}.${iv.toString('base64')}.${authTag.toString('base64')}`
}

function CheckServiceToken(token, mustCreateAfter) {
    try {
        const parts = token.split('.')
        const edata = Buffer.from(parts[0], 'base64')
        const keyIndex = parseInt(parts[1], 10)
        const iv = Buffer.from(parts[2], 'base64')
        const authTag = Buffer.from(parts[3], 'base64')

        const key = serviceKeys[keyIndex]   
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(authTag)

        const resultBuffer = Buffer.concat([decipher.update(edata), decipher.final()])

        const data = JSON.parse(resultBuffer.toString('utf-8'))
        if (data.exp <= Math.floor(new Date().getTime() / 1000)) {
            console.log(`token expired: ${token}`)
            return null
        }

        if (mustCreateAfter != null && data.iat < Math.floor(new Date(mustCreateAfter).getTime() / 1000)) {
            console.log(`token create time invalid, require: ${new Date(mustCreateAfter).toISOString()}, got: ${new Date(data.iat * 1000)}`)
            return null
        }

        return data
    } catch (e) {
        console.log(e)
        console.log(`invalid token: ${token}`)
        return null
    }
}

module.exports = { CreateServiceToken, CheckServiceToken }
