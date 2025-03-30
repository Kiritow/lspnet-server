import koaRouter from "koa-router";
import { z } from "zod";

import { logger, dao, mustLogin } from "./common";
import { GetAllValidLinkSubnetsFromCIDR, parseNodeConfig, readableZodError } from "./utils";
import { CreateJoinClusterToken } from "./simple-token";
import { _nodeConfigSchema, NodeConfig } from "./model";
import { runLinkController } from "./link-controller";

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

router.get("/node/list", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const query = z
        .object({
            clusterId: z.coerce.number(),
        })
        .safeParse(ctx.query);

    if (!query.success) {
        ctx.status = 400;
        ctx.body = readableZodError(query.error);
        return;
    }

    const { clusterId } = query.data;

    const userRole = await dao.getUserRole(userInfo.id, clusterId);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    const nodes = await dao.getNodesByClusterId(clusterId);
    ctx.body = {
        nodes,
    };
});

router.get("/node/info", async (ctx) => {
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

    const { id: nodeId } = query.data;
    const nodeInfo = await dao.getNodeInfoById(nodeId);
    if (nodeInfo === null) {
        ctx.status = 404;
        ctx.body = `Node ${nodeId} not found`;
        return;
    }

    const userRole = await dao.getUserRole(userInfo.id, nodeInfo.clusterId);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    ctx.body = {
        node: nodeInfo,
    };
});

router.post("/node/update_config", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const body = z
        .object({
            id: z.coerce.number(),
            config: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        ctx.body = readableZodError(body.error);
        return;
    }

    const { id: nodeId, config } = body.data;
    const nodeInfo = await dao.getNodeInfoById(nodeId);
    if (nodeInfo === null) {
        ctx.status = 404;
        ctx.body = `Node ${nodeId} not found`;
        return;
    }

    const userRole = await dao.getUserRole(userInfo.id, nodeInfo.clusterId);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    if (userRole < 2) {
        ctx.status = 403;
        ctx.body = "You do not have permission to update node config";
        return;
    }

    let parsedConfig: NodeConfig;
    try {
        parsedConfig = parseNodeConfig(config);
    } catch (e) {
        console.log(e);
        ctx.status = 400;
        ctx.body = e instanceof Error ? e.message : "Invalid config";
        return;
    }

    await dao.updateNode(nodeId, { config: JSON.stringify(parsedConfig) });
    ctx.body = {
        message: "OK",
    };
});

router.post("/link/create", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const body = z
        .object({
            clusterId: z.number(),
            srcNodeId: z.number(),
            dstNodeId: z.number(),
            dstIP: z.string().min(7), // should be optional, but make it required for now
            dstPort: z.number().min(1024).max(65535), // should be optional, but make it required for now
            extra: z.string().optional(),
        })
        .safeParse(ctx.request.body);

    if (!body.success) {
        ctx.status = 400;
        ctx.body = readableZodError(body.error);
        return;
    }

    const { clusterId, srcNodeId, dstNodeId, dstIP, dstPort, extra } =
        body.data;
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

    if (userRole < 1) {
        ctx.status = 403;
        ctx.body = "You do not have permission to create link";
        return;
    }

    const srcNode = await dao.getNodeInfoById(srcNodeId);
    if (srcNode === null) {
        ctx.status = 404;
        ctx.body = `Node ${srcNodeId} not found`;
        return;
    }

    const dstNode = await dao.getNodeInfoById(dstNodeId);
    if (dstNode === null) {
        ctx.status = 404;
        ctx.body = `Node ${dstNodeId} not found`;
        return;
    }

    if (srcNode.clusterId !== clusterId) {
        ctx.status = 400;
        ctx.body = `Node ${srcNodeId} not in cluster ${clusterId}`;
        return;
    }

    if (dstNode.clusterId !== clusterId) {
        ctx.status = 400;
        ctx.body = `Node ${dstNodeId} not in cluster ${clusterId}`;
        return;
    }

    if (srcNode.id === dstNode.id) {
        ctx.status = 400;
        ctx.body = `Cannot create link to self`;
        return;
    }

    const extraInfo = {
        createUserId: userInfo.id,
    };
    if (extra !== undefined) {
        try {
            const jExtra = JSON.parse(extra);
            Object.assign(extraInfo, jExtra);
        } catch (e) {
            console.log(e);

            ctx.status = 400;
            ctx.body = "Invalid extra info";
            return;
        }
    }

    const linkTemplateId = await dao.createLinkTemplate({
        srcNodeId,
        dstNodeId,
        connectIP: dstIP,
        dstPort,
        extra: JSON.stringify(extraInfo),
    });

    ctx.body = {
        message: "OK",
        linkId: linkTemplateId,
    };
});

router.post("/link/update", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const body = z
        .object({
            id: z.number(),
            connectIP: z.string().min(7), // should be optional, but make it required for now
            dstPort: z.number().min(1024).max(65535), // should be optional, but make it required for now
            extra: z.string().optional(),
        })
        .safeParse(ctx.request.body);

    if (!body.success) {
        ctx.status = 400;
        ctx.body = readableZodError(body.error);
        return;
    }

    const { id: linkId, connectIP, dstPort, extra } = body.data;
    const linkTemplate = await dao.getLinkTemplateById(linkId);
    if (linkTemplate === null) {
        ctx.status = 404;
        ctx.body = `Link ${linkId} not found`;
        return;
    }

    const srcNode = await dao.getNodeInfoById(linkTemplate.srcNodeId);
    if (srcNode === null) {
        ctx.status = 404;
        ctx.body = `Node ${linkTemplate.srcNodeId} not found`;
        return;
    }

    const clusterInfo = await dao.getClusterInfo(srcNode.clusterId);
    if (clusterInfo === null) {
        ctx.status = 404;
        ctx.body = `Cluster ${srcNode.clusterId} not found`;
        return;
    }

    const userRole = await dao.getUserRole(userInfo.id, clusterInfo.id);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    if (userRole < 1) {
        ctx.status = 403;
        ctx.body = "You do not have permission to update link";
        return;
    }

    if (extra !== undefined) {
        try {
            const jExtra = JSON.parse(extra);
            Object.assign(linkTemplate.extra, jExtra);
        } catch (e) {
            console.log(e);

            ctx.status = 400;
            ctx.body = "Invalid extra info";
            return;
        }
    }

    await dao.updateLinkTemplate(linkId, {
        connectIP,
        dstPort,
        extra,
    });

    ctx.body = {
        message: "OK",
    };
});

router.get("/link/list", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const query = z
        .object({
            clusterId: z.coerce.number(),
        })
        .safeParse(ctx.query);

    if (!query.success) {
        ctx.status = 400;
        ctx.body = readableZodError(query.error);
        return;
    }

    const { clusterId } = query.data;

    const userRole = await dao.getUserRole(userInfo.id, clusterId);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    const linkTemplates = await dao.getLinkTemplatesByClusterId(clusterId);
    ctx.body = {
        templates: linkTemplates,
    };
});

router.get("/link/info", async (ctx) => {
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

    const { id: linkId } = query.data;
    const linkTemplate = await dao.getLinkTemplateById(linkId);
    if (linkTemplate === null) {
        ctx.status = 404;
        ctx.body = `Link ${linkId} not found`;
        return;
    }
    const srcNode = await dao.getNodeInfoById(linkTemplate.srcNodeId);
    if (srcNode === null) {
        ctx.status = 404;
        ctx.body = `Node ${linkTemplate.srcNodeId} not found`;
        return;
    }
    const clusterInfo = await dao.getClusterInfo(srcNode.clusterId);
    if (clusterInfo === null) {
        ctx.status = 404;
        ctx.body = `Cluster ${srcNode.clusterId} not found`;
        return;
    }
    const userRole = await dao.getUserRole(userInfo.id, clusterInfo.id);
    if (userRole === null) {
        ctx.status = 403;
        ctx.body = "You do not have permission to access this cluster";
        return;
    }

    ctx.body = {
        template: linkTemplate,
    };
});

// experimental
router.post("/link/refresh", async (ctx) => {
    const userInfo = await mustLogin(ctx);
    if (!userInfo) return;

    const startTime = new Date();
    await runLinkController();
    const costTimeMs = new Date().getTime() - startTime.getTime();

    ctx.body = {
        message: `Refresh completed in ${costTimeMs}ms`,
    };
});

export default router;
