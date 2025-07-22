import dayjs from "dayjs";
import { BaseConnection, BaseDaoClass } from "./base-dao";
import {
    _clusterSchema,
    _clusterSubnetSchema,
    _nodeInfoSchema,
    _nodeLinkTemplateSchema,
    _nodeWireGuardKeySchema,
    _nodeWireGuardLinkSchema,
    _userInfoSchema,
    NodeInfo,
    UserInfo,
} from "./model";

export function tsToMySQLTime(ts: number): string {
    return dayjs(ts).format("YYYY-MM-DD HH:mm:ss");
}

export class DaoClass extends BaseDaoClass {
    async getPlatformUser(platform: string, platformUid: string) {
        const result = await this.query(
            "select * from t_user where f_platform=? and f_platform_uid=?",
            [platform, platformUid]
        );
        if (result.length < 1) {
            return null;
        }
        return _userInfoSchema.parse(result[0]);
    }

    async getUserByID(uid: string): Promise<UserInfo | null> {
        const result = await this.query("select * from t_user where f_id=?", [
            uid,
        ]);
        if (result.length < 1) {
            return null;
        }
        return _userInfoSchema.parse(result[0]);
    }

    async createUser(
        platform: string,
        platformUid: string,
        platformUsername: string
    ) {
        const result = await this.insert("t_user", {
            f_platform: platform,
            f_platform_uid: platformUid,
            f_username: platformUsername,
        });
        return result.insertId;
    }

    async getClustersByUser(userId: number) {
        const result = await this.query(
            "select * from t_cluster where f_id in (select f_cluster_id from t_user_role where f_user_id=?)",
            [userId]
        );
        return result.map((row) => _clusterSchema.parse(row));
    }

    async createCluster(
        clusterName: string,
        clusterSubnetCIDR: string,
        clusterSubnetCIDRs: string[],
        createUserId: number
    ) {
        const conn = await this.getConnection();
        try {
            await conn.begin();
            const result = await conn.insert("t_cluster", {
                f_name: clusterName,
                f_subnet_cidr: clusterSubnetCIDR,
            });
            const newClusterId = result.insertId;

            for (let i = 0; i < clusterSubnetCIDRs.length; i++) {
                const subnetCIDR = clusterSubnetCIDRs[i];
                await conn.insert("t_subnet", {
                    f_cluster_id: newClusterId,
                    f_subnet_cidr: subnetCIDR,
                    f_status: 0, // available
                });
            }

            await conn.insert("t_user_role", {
                f_user_id: createUserId,
                f_cluster_id: newClusterId,
                f_role_id: 2, // admin
            });

            await conn.commit();

            return newClusterId;
        } finally {
            conn.finish();
        }
    }

    async getUserRole(
        userId: number,
        clusterId: number
    ): Promise<number | null> {
        const result = await this.query(
            "select * from t_user_role where f_user_id=? and f_cluster_id=?",
            [userId, clusterId]
        );
        if (result.length < 1) {
            return null;
        }
        return result[0].f_role_id;
    }

    async getNodeInfoBySignKeyHash(hash: string): Promise<NodeInfo | null> {
        const result = await this.query(
            "select * from t_node_info where f_public_sign_key_hash=?",
            [hash]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeInfoSchema.parse(result[0]);
    }

    async getNodeInfoById(nodeId: number) {
        const result = await this.query(
            "select * from t_node_info where f_id=?",
            [nodeId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeInfoSchema.parse(result[0]);
    }

    async getNodesByClusterId(clusterId: number) {
        const result = await this.query(
            "select * from t_node_info where f_cluster_id=?",
            [clusterId]
        );
        return result.map((row) => _nodeInfoSchema.parse(row));
    }

    async createNodeInfo(
        clusterId: number,
        nodeName: string,
        publicSignKey: string,
        publicSignKeyHash: string,
        config: string
    ) {
        const result = await this.insert("t_node_info", {
            f_cluster_id: clusterId,
            f_node_name: nodeName,
            f_public_sign_key: publicSignKey,
            f_public_sign_key_hash: publicSignKeyHash,
            f_config: config,
        });
        return result.insertId;
    }

    async updateNode(
        nodeId: number,
        data: {
            config?: string;
            lastSeenTs?: number;
        }
    ) {
        const sqlParts: string[] = [];
        const params: unknown[] = [];

        if (data.config !== undefined) {
            sqlParts.push("f_config=?");
            params.push(data.config);
        }
        if (data.lastSeenTs !== undefined) {
            sqlParts.push("f_last_seen=?");
            params.push(tsToMySQLTime(data.lastSeenTs));
        }
        if (sqlParts.length < 1) {
            return;
        }

        const sql = `update t_node_info set ${sqlParts.join(",")} where f_id=?`;
        params.push(nodeId);

        await this.run(sql, params);
    }

    async createLinkTemplate(data: {
        srcNodeId: number;
        dstNodeId: number;
        connectIP?: string;
        dstPort?: number;
        enabled?: boolean;
        extra?: string;
    }) {
        const result = await this.insert("t_node_link_template", {
            f_src_node_id: data.srcNodeId,
            f_dst_node_id: data.dstNodeId,
            f_dst_listen_port: data.dstPort,
            f_connect_ip: data.connectIP,
            f_enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1,
            f_extra: data.extra ?? "",
        });
        return result.insertId;
    }

    async getAllLinkTemplates() {
        const result = await this.query(
            "select * from t_node_link_template",
            []
        );
        return result.map((row) => _nodeLinkTemplateSchema.parse(row));
    }

    async getLinkTemplatesByClusterId(clusterId: number) {
        const result = await this.query(
            `select * from t_node_link_template where 
                f_src_node_id in (select f_id from t_node_info where f_cluster_id=?)
                and
                f_dst_node_id in (select f_id from t_node_info where f_cluster_id=?)`,
            [clusterId, clusterId]
        );
        return result.map((row) => _nodeLinkTemplateSchema.parse(row));
    }

    async getLinkTemplateById(linkTemplateId: number) {
        const result = await this.query(
            "select * from t_node_link_template where f_id=?",
            [linkTemplateId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeLinkTemplateSchema.parse(result[0]);
    }

    async getLinkTemplateByLinkId(linkId: number) {
        const result = await this.query(
            "select * from t_node_link_template where f_wglink_client_id=? or f_wglink_server_id=?",
            [linkId, linkId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeLinkTemplateSchema.parse(result[0]);
    }

    async updateLinkTemplate(
        linkTemplateId: number,
        data: {
            connectIP?: string;
            dstPort?: number;
            extra?: string;
        }
    ) {
        const sqlParts: string[] = [];
        const params: unknown[] = [];

        if (data.connectIP !== undefined) {
            sqlParts.push("f_connect_ip=?");
            params.push(data.connectIP);
        }
        if (data.dstPort !== undefined) {
            sqlParts.push("f_dst_listen_port=?");
            params.push(data.dstPort);
        }
        if (data.extra !== undefined) {
            sqlParts.push("f_extra=?");
            params.push(data.extra);
        }
        if (sqlParts.length < 1) {
            return;
        }

        const sql = `update t_node_link_template set ${sqlParts.join(",")},f_ready=0 where f_id=?`;
        params.push(linkTemplateId);

        await this.run(sql, params);
    }

    async _lockNodeInfo(conn: BaseConnection, nodeId: number) {
        const result = await conn.query(
            "select * from t_node_info where f_id=? for update",
            [nodeId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeInfoSchema.parse(result[0]);
    }

    async _lockLinkTemplate(conn: BaseConnection, linkTemplateId: number) {
        const result = await conn.query(
            "select * from t_node_link_template where f_id=? for update",
            [linkTemplateId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeLinkTemplateSchema.parse(result[0]);
    }

    async _disableWireGuardLink(conn: BaseConnection, linkId: number) {
        await conn.run("update t_node_wglink set f_status=0 where f_id=?", [
            linkId,
        ]);
    }

    async _lockUnusedWireGuardKeys(conn: BaseConnection, nodeId: number) {
        const result = await conn.query(
            "select * from t_node_wgkey where f_node_id=? and f_status=0 for update",
            [nodeId]
        );
        return result.map((row) => _nodeWireGuardKeySchema.parse(row));
    }

    async _markWireGuardKeyUsed(conn: BaseConnection, keyId: number) {
        await conn.run("update t_node_wgkey set f_status=1 where f_id=?", [
            keyId,
        ]);
    }

    async _lockAnySubnet(conn: BaseConnection, clusterId: number) {
        const result = await conn.query(
            "select * from t_subnet where f_cluster_id=? and f_status=0 limit 1 for update",
            [clusterId]
        );
        if (result.length < 1) {
            return null;
        }
        return _clusterSubnetSchema.parse(result[0]);
    }

    async _markSubnetUsed(conn: BaseConnection, subnetId: number) {
        await conn.run("update t_subnet set f_status=1 where f_id=?", [
            subnetId,
        ]);
    }

    async _createWireGuardLink(
        conn: BaseConnection,
        data: {
            nodeId: number;
            wgKeyId: number;
            listenPort: number;
            mtu: number;
            subnetId: number;
            type: number;
            peerNodeId: number;
            peerPublicKeyId: number;
            keepalive: number;
            endpointMode: number;
            endpointTemplate: string;
            endpoint: string;
            extra: string;
            status: number;
        }
    ) {
        const result = await conn.insert("t_node_wglink", {
            f_node_id: data.nodeId,
            f_wgkey_id: data.wgKeyId,
            f_listen_port: data.listenPort,
            f_mtu: data.mtu,
            f_subnet_id: data.subnetId,
            f_type: data.type,
            f_peer_node_id: data.peerNodeId,
            f_peer_wgkey_id: data.peerPublicKeyId,
            f_keepalive: data.keepalive,
            f_endpoint_mode: data.endpointMode,
            f_endpoint_template: data.endpointTemplate,
            f_endpoint: data.endpoint,
            f_extra: data.extra,
            f_status: data.status,
        });
        return result.insertId;
    }

    async _lockWireGuardLink(conn: BaseConnection, linkId: number) {
        const result = await conn.query(
            "select * from t_node_wglink where f_id=? for update",
            [linkId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeWireGuardLinkSchema.parse(result[0]);
    }

    async _updateWireGuardLink(
        conn: BaseConnection,
        linkId: number,
        data: {
            listenPort?: number;
            endpointMode?: number;
            endpointTemplate?: string;
            endpoint?: string;
            extra?: string;
        }
    ) {
        const sqlParts: string[] = [];
        const params: unknown[] = [];

        if (data.listenPort !== undefined) {
            sqlParts.push("f_listen_port=?");
            params.push(data.listenPort);
        }

        if (data.endpointMode !== undefined) {
            sqlParts.push("f_endpoint_mode=?");
            params.push(data.endpointMode);
        }

        if (data.endpointTemplate !== undefined) {
            sqlParts.push("f_endpoint_template=?");
            params.push(data.endpointTemplate);
        }

        if (data.endpoint !== undefined) {
            sqlParts.push("f_endpoint=?");
            params.push(data.endpoint);
        }

        if (data.extra !== undefined) {
            sqlParts.push("f_extra=?");
            params.push(data.extra);
        }
        if (sqlParts.length < 1) {
            return;
        }

        const sql = `update t_node_wglink set ${sqlParts.join(",")} where f_id=?`;
        params.push(linkId);

        await conn.run(sql, params);
    }

    async updateNodeWireGuardKeys(nodeId: number, keys: string[]) {
        const results = await this.query(
            "select * from t_node_wgkey where f_node_id=?",
            [nodeId]
        );
        const existKeys = new Set(results.map((row) => row.f_public_key));
        await Promise.all(
            keys.map(async (key) => {
                if (existKeys.has(key)) {
                    return;
                }
                await this.insertIgnore("t_node_wgkey", {
                    f_node_id: nodeId,
                    f_public_key: key,
                });
            })
        );
    }

    async getWireGuardKeyById(keyId: number) {
        const result = await this.query(
            "select * from t_node_wgkey where f_id=?",
            [keyId]
        );
        if (result.length < 1) {
            return null;
        }
        return _nodeWireGuardKeySchema.parse(result[0]);
    }

    async getEnabledWireGuardLinks(nodeId: number) {
        const result = await this.query(
            "select * from t_node_wglink where f_node_id=? and f_status=1",
            [nodeId]
        );
        return result.map((row) => _nodeWireGuardLinkSchema.parse(row));
    }

    async getClusterSubnetById(subnetId: number) {
        const result = await this.query("select * from t_subnet where f_id=?", [
            subnetId,
        ]);
        if (result.length < 1) {
            return null;
        }
        return _clusterSubnetSchema.parse(result[0]);
    }

    async getClusterInfo(clusterId: number) {
        const result = await this.query(
            "select * from t_cluster where f_id=?",
            [clusterId]
        );
        if (result.length < 1) {
            return null;
        }
        return _clusterSchema.parse(result[0]);
    }
}
