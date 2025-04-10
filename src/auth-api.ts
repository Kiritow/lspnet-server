import koaRouter from "koa-router";
import axios from "axios";
import { z } from "zod";

import { logger, dao, getWebUser } from "./common";
import { GetGithubOAuthAppSync } from "./credentials";

const { id: GITHUB_CLIENT_ID, secret: GITHUB_CLIENT_SECRET } =
    GetGithubOAuthAppSync();

const router = new koaRouter({
    prefix: "/auth",
});

export default router;

interface githubAccessToken {
    token: string;
    type: string;
}

interface githubProfile {
    username: string;
    userid: string;
}

async function GetGithubAccessToken(
    code: string
): Promise<githubAccessToken | null> {
    try {
        const r = await axios.post(
            "https://github.com/login/oauth/access_token",
            {
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
            },
            {
                headers: {
                    Accept: "application/json",
                },
            }
        );
        if (r.status != 200) {
            return null;
        }
        const { access_token: accessToken, token_type: tokenType } = r.data;
        return { token: accessToken, type: tokenType };
    } catch (e) {
        logger.error(e);
        return null;
    }
}

async function LoadGithubProfile(
    accessToken: githubAccessToken
): Promise<githubProfile | null> {
    try {
        const r2 = await axios.get("https://api.github.com/user", {
            headers: {
                Authorization: `${accessToken.type} ${accessToken.token}`,
            },
        });
        if (r2.status != 200) {
            return null;
        }

        const { node_id: githubUserID, login: githubLoginName } = r2.data;
        if (githubUserID == null || githubUserID.length < 1) {
            return null;
        }

        return { username: githubLoginName, userid: githubUserID };
    } catch (e) {
        logger.error(e);
        return null;
    }
}

router.get("/login/github", async (ctx) => {
    const query = z
        .object({
            service: z.string().optional(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        return;
    }

    let serviceUri = query.data.service || "/admin";
    if (!serviceUri.startsWith("/")) {
        logger.warn(`filter illegal service: ${serviceUri}`);
        serviceUri = "/admin";
    }
    serviceUri = encodeURIComponent(serviceUri);
    const redirectUri = encodeURIComponent(
        `https://${ctx.host}/auth/login/github/callback?service=${serviceUri}`
    );
    ctx.redirect(
        `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}`
    );
});

router.get("/login/github/callback", async (ctx) => {
    const query = z
        .object({
            code: z.string().min(1),
            service: z.string().optional(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        return;
    }

    const { code, service } = query.data;

    const accessToken = await GetGithubAccessToken(code);
    if (accessToken === null) {
        ctx.status = 401;
        return;
    }

    const userProfile = await LoadGithubProfile(accessToken);
    if (userProfile === null) {
        ctx.status = 401;
        return;
    }

    const accountInfo = await dao.getPlatformUser("github", userProfile.userid);

    let userId: number;
    if (accountInfo == null) {
        // create new user
        const newUserId = await dao.createUser(
            "github",
            userProfile.userid,
            userProfile.username
        );
        logger.info(`NewUser: ${userProfile.username}(${userProfile.userid})`);
        userId = newUserId;
    } else {
        userId = accountInfo.id;
    }

    ctx.session!.uid = userId;

    let serviceUrl = decodeURIComponent(service || "/admin");
    if (!serviceUrl.startsWith("/")) {
        serviceUrl = "/admin";
    }
    ctx.redirect(serviceUrl);
});

router.get("/logout", (ctx) => {
    ctx.session = null;
    ctx.body = "You have logged out";
});

router.get("/user", async (ctx) => {
    const accountInfo = await getWebUser(ctx);
    if (!accountInfo) {
        ctx.status = 401;
        ctx.body = "user not logged in";
        return;
    }

    ctx.body = {
        username: accountInfo.username,
    };
});
