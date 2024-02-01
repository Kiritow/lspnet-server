const koaRouter = require('koa-router')
const { CreateAuthToken } = require('./simple-token')

const { logger, dao } = require('./common')

const router = new koaRouter({
    prefix: '/admin',
})

router.get('/', async ctx => {
    if (ctx.session.isNew || ctx.session.uid == null || ctx.session.uid <= 0) {
        const redirectUri = encodeURIComponent(`https://${ctx.host}/admin`)
        ctx.redirect(`/auth/login/github?service=${redirectUri}`)
        return
    }

    const accountInfo = await dao.getUserByID(ctx.session.uid)
    if (accountInfo == null) {
        logger.warn(`invalid uid: ${ctx.session.uid}`)
        ctx.body = 'invalid user'
        return
    }

    const token = CreateAuthToken()
    ctx.body = {
        username: accountInfo.uname,
        token,
    }
})

module.exports = router
