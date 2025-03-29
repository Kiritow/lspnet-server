import z from "zod";

export const _userInfoSchema = z
    .object({
        f_id: z.number(),
        f_platform: z.string(),
        f_platform_uid: z.string(),
        f_username: z.string(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            platform: row.f_platform,
            platformUid: row.f_platform_uid,
            username: row.f_username,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type UserInfo = z.infer<typeof _userInfoSchema>;

export const _userRoleSchema = z
    .object({
        f_id: z.number(),
        f_user_id: z.number(),
        f_cluster_id: z.number(),
        f_role_id: z.number(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            userId: row.f_user_id,
            clusterId: row.f_cluster_id,
            roleId: row.f_role_id,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type UserRole = z.infer<typeof _userRoleSchema>;

export const _nodeInfoSchema = z
    .object({
        f_id: z.number(),
        f_cluster_id: z.number(),
        f_node_name: z.string(),
        f_public_sign_key: z.string(),
        f_public_sign_key_hash: z.string(),
        f_config: z.string(),
        f_status: z.number(),
        f_last_seen: z.coerce.date(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            clusterId: row.f_cluster_id,
            nodeName: row.f_node_name,
            publicSignKey: row.f_public_sign_key,
            publicSignKeyHash: row.f_public_sign_key_hash,
            config: row.f_config,
            status: row.f_status,
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

export const _nodeStatusSchema = z.object({});

export type NodeStatus = z.infer<typeof _nodeStatusSchema>;

export const _nodeWireGuardKeySchema = z
    .object({
        f_id: z.number(),
        f_node_id: z.number(),
        f_public_key: z.string(),
        f_status: z.number(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            nodeId: row.f_node_id,
            publicKey: row.f_public_key,
            status: row.f_status,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type NodeWireGuardKey = z.infer<typeof _nodeWireGuardKeySchema>;

export const _nodeWireGuardLinkSchema = z
    .object({
        f_id: z.number(),
        f_node_id: z.number(),
        f_wgkey_id: z.number(),
        f_listen_port: z.number(),
        f_mtu: z.number(),
        f_subnet_id: z.number(),
        f_type: z.number(),
        f_peer_node_id: z.number(),
        f_peer_wgkey_id: z.number(),
        f_keepalive: z.number(),
        f_endpoint_mode: z.number(),
        f_endpoint_template: z.string(),
        f_endpoint: z.string(),
        f_extra: z.string(),
        f_status: z.number(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            nodeId: row.f_node_id,
            wgKeyId: row.f_wgkey_id,
            listenPort: row.f_listen_port,
            mtu: row.f_mtu,
            subnetId: row.f_subnet_id,
            type: row.f_type,
            peerNodeId: row.f_peer_node_id,
            peerPublicKeyId: row.f_peer_wgkey_id,
            keepalive: row.f_keepalive,
            endpointMode: row.f_endpoint_mode,
            endpointTemplate: row.f_endpoint_template,
            endpoint: row.f_endpoint,
            extra: row.f_extra,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type NodeWireGuardLink = z.infer<typeof _nodeWireGuardLinkSchema>;

export const _clusterSubnetSchema = z
    .object({
        f_id: z.number(),
        f_cluster: z.string(),
        f_subnet_cidr: z.string(),
        f_status: z.number(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            cluster: row.f_cluster,
            subnetCIDR: row.f_subnet_cidr,
            status: row.f_status,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type ClusterSubnet = z.infer<typeof _clusterSubnetSchema>;

export const _clusterSchema = z
    .object({
        f_id: z.number(),
        f_name: z.string(),
        f_subnet_cidr: z.string(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            name: row.f_name,
            subnetCIDR: row.f_subnet_cidr,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type ClusterInfo = z.infer<typeof _clusterSchema>;

export const _nodeInboxMsgSchema = z
    .object({
        f_id: z.number(),
        f_node_id: z.number(),
        f_content: z.string(),
        f_ack: z.number(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            nodeId: row.f_node_id,
            content: row.f_content,
            ack: row.f_ack,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type NodeInboxMsg = z.infer<typeof _nodeInboxMsgSchema>;

export const _nodeEventSchema = z
    .object({
        f_id: z.number(),
        f_node_id: z.number(),
        f_type: z.string(),
        f_content: z.string(),
        f_create_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            nodeId: row.f_node_id,
            type: row.f_type,
            content: row.f_content,
            createTime: row.f_create_time,
        };
    });

export type NodeEvent = z.infer<typeof _nodeEventSchema>;
