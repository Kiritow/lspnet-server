const koaRouter = require('koa-router')
const axios = require('axios').default
const { logger, dao } = require('./common')
const { GetGithubOAuthAppSync } = require('./credentials')

const { id: GITHUB_CLIENT_ID, secret: GITHUB_CLIENT_SECRET } = GetGithubOAuthAppSync()

const router = new koaRouter({
    prefix: '/auth',
})

async function GetGithubAccessToken(code) {
    try {
        const r = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
        }, {
            headers: {
                Accept: 'application/json',
            }
        })
        if (r.status != 200) {
            return null
        }
        const { access_token: accessToken, token_type: tokenType } = r.data
        return { token: accessToken, type: tokenType }
    } catch (e) {
        logger.error(e)
        return null
    }
}

async function LoadGithubProfile(accessToken) {
    try {
        const r2 = await axios.get('https://api.github.com/user', {
            headers: {
                Authorization: `${accessToken.type} ${accessToken.token}`
            }
        })
        if (r2.status != 200) {
            return null
        }

        const { node_id: githubUserID, login: githubLoginName } = r2.data
        if (githubUserID == null || githubUserID.length < 1) {
            return null
        }

        return { username: githubLoginName, userid: githubUserID }
    } catch (e) {
        logger.error(e)
        return null
    }
}

router.get('/login/github', async (ctx) => {
    let serviceUri = ctx.query.service || '/admin'
    if (!serviceUri.startsWith('/')) {
        logger.warn(`filter illegal service: ${serviceUri}`)
        serviceUri = '/admin'
    }
    serviceUri = encodeURIComponent(serviceUri)
    const redirectUri = encodeURIComponent(`https://${ctx.host}/auth/login/github/callback?service=${serviceUri}`)
    ctx.redirect(`https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}`)
})

router.get('/login/github/callback', async (ctx) => {
    const { code } = ctx.query
    if (code == null || code.length < 1) {
        ctx.status = 400
        return
    }

    const accessToken = await GetGithubAccessToken(code)
    if (accessToken == null) {
        ctx.status = 401
        return
    }

    const userProfile = await LoadGithubProfile(accessToken)
    if (userProfile == null) {
        ctx.status = 401
        return
    }

    const accountInfo = await dao.getPlatformUser('github', userProfile.userid)
    if (accountInfo == null) {
        logger.error(`github user: ${userProfile.username} (${userProfile.userid}) not registered.`)
        ctx.body = 'Invalid user'
        return
    }

    ctx.session.uid = accountInfo.uid

    let serviceUrl = decodeURIComponent(ctx.query.service)
    if (!serviceUrl.startsWith('/')) {
        serviceUrl = '/admin'
    }
    ctx.redirect(serviceUrl)
})

router.get('/logout', ctx => {
    ctx.session = null
    ctx.body = 'You have logged out'
})

module.exports = router
