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

export const _nodeLinkTemplateSchema = z
    .object({
        f_id: z.number(),
        f_src_node_id: z.number(),
        f_src_wgkey_id: z.number(),
        f_src_listen_port: z.number(),
        f_dst_node_id: z.number(),
        f_dst_wgkey_id: z.number(),
        f_dst_listen_port: z.number(),
        f_mtu: z.number(),
        f_subnet_id: z.number(),
        f_connect_ip: z.string(),
        f_wglink_client_id: z.number(),
        f_wglink_server_id: z.number(),
        f_extra: z.string(),
        f_enabled: z.number(),
        f_ready: z.number(),

        f_last_check: z.coerce.date(),
        f_last_sync: z.coerce.date(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            srcNodeId: row.f_src_node_id,
            srcWgKeyId: row.f_src_wgkey_id,
            srcListenPort: row.f_src_listen_port,
            dstNodeId: row.f_dst_node_id,
            dstWgKeyId: row.f_dst_wgkey_id,
            dstListenPort: row.f_dst_listen_port,
            mtu: row.f_mtu,
            subnetId: row.f_subnet_id,
            connectIP: row.f_connect_ip,
            wgLinkClientId: row.f_wglink_client_id,
            wgLinkServerId: row.f_wglink_server_id,
            extra: row.f_extra,
            enabled: row.f_enabled,
            ready: row.f_ready,

            lastCheck: row.f_last_check,
            lastSync: row.f_last_sync,
            createTime: row.f_create_time,
            updateTime: row.f_update_time,
        };
    });

export type NodeLinkTemplate = z.infer<typeof _nodeLinkTemplateSchema>;

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
        f_cluster_id: z.number(),
        f_subnet_cidr: z.string(),
        f_status: z.number(),
        f_create_time: z.coerce.date(),
        f_update_time: z.coerce.date(),
    })
    .transform((row) => {
        return {
            id: row.f_id,
            clusterId: row.f_cluster_id,
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

const _nodeInnerRouterInfoSchema = z.object({
    router_id: z.string(),
    metric: z.number(),
});

const _nodeInnerNetworkInfoSchema = z.object({
    network: z.string(),
    metric: z.number(),
});

const _nodeExternalNetworkInfoSchema = z.object({
    network: z.string(),
    metric: z.number(),
    metric_type: z.number(),
    via: z.string().optional().nullable(),
    tag: z.string().optional().nullable(),
});

export const _nodeRouterInfoSchema = z.object({
    router_id: z.string(),
    distance: z.number(),
    vlinks: _nodeInnerRouterInfoSchema.array(),
    routers: _nodeInnerRouterInfoSchema.array(),
    stubnets: _nodeInnerNetworkInfoSchema.array(),
    xnetworks: _nodeInnerNetworkInfoSchema.array(),
    xrouters: _nodeInnerRouterInfoSchema.array(),
    externals: _nodeExternalNetworkInfoSchema.array(),
    nssa_externals: _nodeExternalNetworkInfoSchema.array(),
});

export type NodeRouterInfo = z.infer<typeof _nodeRouterInfoSchema>;

export const _underlayConfigSchema = z.object({
    provider: z.literal("gost"),
    config: z.object({
        client_port: z.number(),
        server_port: z.number(),
        enable_auth: z.boolean().optional(), // default is false. if true, an username and password will be generated.
    }),
});

export const _linkTemplateExtraSchema = z.object({
    ospf: z.object({
        cost: z.number(),
        ping: z.boolean(),
        offset: z.number(),
        auth: z.string().optional(),
        offset_client: z.number().optional(),
        offset_server: z.number().optional(),
    }),
    multilisten: z.array(z.number()).optional(),
    multiport: z.array(z.number()).optional(),
    underlay: _underlayConfigSchema.optional(),
});

export type LinkTemplateExtraInfo = z.infer<typeof _linkTemplateExtraSchema> & {
    endpointMode?: number;
    endpointHost?: string;
};

export interface LinkExtraInfo {
    templateId: number;
    ospf: {
        cost: number;
        ping: boolean;
        offset: number;
        auth?: string;
    };

    endpointMode?: number;
    endpointHost?: string;

    multilisten?: number[];
    multiport?: number[];
    underlay?: {
        provider: "gost_relay_client" | "gost_relay_server";
        config_gost_relay_client?: {
            listen_port: number;
            server_addr: string;
            server_port: number;
            username?: string;
            password?: string;
        };
        config_gost_relay_server?: {
            listen_port: number;
            username?: string;
            password?: string;
        };
    };
}
