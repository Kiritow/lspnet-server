import z from "zod";

export const _userInfoSchema = z.object({
    uid: z.number(),
    platform: z.string(),
    platform_uid: z.string(),
    uname: z.string(),
});

export type UserInfo = z.infer<typeof _userInfoSchema>;

export const _nodeInfoSchema = z
    .object({
        f_id: z.number(),
        f_cluster: z.string(),
        f_node_id: z.string(), // uuidv4
        f_node_name: z.string(),
        f_public_sign_key: z.string(),
        f_public_sign_key_hash: z.string(),
        f_config: z.string(),
        f_report_status: z.string(),
        f_last_seen: z.coerce.date(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            cluster: row.f_cluster,
            nodeId: row.f_node_id,
            nodeName: row.f_node_name,
            publicSignKey: row.f_public_sign_key,
            publicSignKeyHash: row.f_public_sign_key_hash,
            config: row.f_config,
            reportStatus: row.f_report_status,
            lastSeen: row.f_last_seen,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type NodeInfo = z.infer<typeof _nodeInfoSchema>;

export const _nodeConfigSchema = z.object({
    ip: z.string(),
    external: z.boolean(),
    ddns: z.boolean(),
    exitNode: z.boolean(),

    vethCIDR: z.string().optional(),
    allowedTCPPorts: z.array(z.number()),
    allowedUDPPorts: z.array(z.number()),

    dummy: z
        .object({
            name: z.string(),
            addressCIDR: z.string(),
            mtu: z.number(),
        })
        .array()
        .optional(),

    // local ospf
    ospf: z
        .object({
            area: z.number(),
            cost: z.number(),
            auth: z.string(),
        })
        .optional(),
});

export type NodeConfig = z.infer<typeof _nodeConfigSchema>;

export const _nodeStatusSchema = z.object({

});

export type NodeStatus = z.infer<typeof _nodeStatusSchema>;
