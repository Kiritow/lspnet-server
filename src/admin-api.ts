import koaRouter from "koa-router";

import { logger, dao, mustLogin } from "./common";
import { z } from "zod";
import { GetAllValidLinkSubnetsFromCIDR, readableZodError } from "./utils";
import { CreateJoinClusterToken } from "./simple-token";

const router = new koaRouter({
    prefix: "/api/admin",
});

router.get("/cluster/list", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const clusters = await dao.getClustersByUser(userInfo.id);
    ctx.body = {
        clusters,
    };
});

router.get("/cluster/info", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const query = z
        .object({
            id: z.coerce.number(),
        })
        .safeParse(ctx.query);

    if (!query.success) {
        ctx.status = 400;
        ctx.body = readableZodError(query.error);
        return;
    }

    const { id: clusterId } = query.data;
    const clusterInfo = await dao.getClusterInfo(clusterId);
    if (clusterInfo === null) {
        ctx.status = 404;
        ctx.body = `Cluster ${clusterId} not found`;
        return;
    }

    const userRole = await dao.getUserRole(userInfo.id, clusterId);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    ctx.body = {
        cluster: clusterInfo,
        role: userRole,
    };
});

router.post("/cluster/create", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const body = z
        .object({ name: z.string(), subnet: z.string() })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        ctx.body = readableZodError(body.error);
        return;
    }

    const { name, subnet } = body.data;
    const allSubnets = GetAllValidLinkSubnetsFromCIDR(subnet);
    if (allSubnets.length === 0) {
        ctx.status = 400;
        ctx.body = "Invalid subnet CIDR";
        return;
    }

    const clusterId = await dao.createCluster(
        name,
        subnet,
        allSubnets,
        userInfo.id
    );
    ctx.body = {
        message: `Cluster ${name} created with ${allSubnets.length} subnets`,
        id: clusterId,
    };
});

router.post("/cluster/create_join_token", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const body = z
        .object({
            id: z.coerce.number(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        ctx.body = readableZodError(body.error);
        return;
    }

    const { id: clusterId } = body.data;

    const clusterInfo = await dao.getClusterInfo(clusterId);
    if (clusterInfo === null) {
        ctx.status = 404;
        ctx.body = `Cluster ${clusterId} not found`;
        return;
    }

    const userRole = await dao.getUserRole(userInfo.id, clusterId);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    if (userRole !== 2) {
        ctx.status = 403;
        ctx.body = "You do not have permission to create join token";
        return;
    }

    const token = CreateJoinClusterToken(clusterId, userInfo.id);
    ctx.body = {
        token,
    };
});

export default router;
