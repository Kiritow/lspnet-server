import { BaseDaoClass } from "./base-dao";
import {
    _clusterSchema,
    _clusterSubnetSchema,
    _nodeInfoSchema,
    _nodeWireGuardKeySchema,
    _nodeWireGuardLinkSchema,
    _userInfoSchema,
    NodeInfo,
    UserInfo,
} from "./model";

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

    async updateNodeWireGuardKeys(nodeId: number, keys: string[]) {
        const results = await this.query(
            "select * from t_node_wgkey where f_node_id=?",
            [nodeId]
        );
        const existKeys = new Set(results.map((row) => row.f_wg_public_key));
        await Promise.all(
            keys.map(async (key) => {
                if (existKeys.has(key)) {
                    return;
                }
                await this.insert("t_node_wgkey", {
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
