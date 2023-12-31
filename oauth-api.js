const koaRouter = require('koa-router')
const axios = require('axios').default
const { logger, dao, LoadUserInfo } = require('./common')
const { CreateServiceToken } = require('./token')
const { GetGithubOAuthAppSync } = require('./credentials')

const { id: GITHUB_CLIENT_ID, secret: GITHUB_CLIENT_SECRET } = GetGithubOAuthAppSync()

const router = new koaRouter({
    prefix: '/auth',
})

router.get('/login/github', async (ctx) => {
    const userInfo = await LoadUserInfo(ctx)
    if (userInfo != null) {
        const { uname: username } = userInfo
        const newToken = CreateServiceToken({
            type: 'auth',
        }, 180)
        ctx.body = {
            username,
            token: newToken,
        }
        return
    }

    const redirectUri = encodeURIComponent(`https://${ctx.host}/auth/login/github/callback`)
    ctx.redirect(`https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}`)
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

    ctx.cookies.set('ss_token', CreateServiceToken({
        type: 'user',
        userid: userProfile.userid,
        platform: 'github',
    }, 300), {
        httpOnly: true,
        secure: true,
        domain: ctx.host,
        maxAge: 300000,
    })

    ctx.redirect(`https://${ctx.host}/auth/login/github`)
})

module.exports = router
