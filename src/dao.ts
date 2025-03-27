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
            "select * from t_user where platform=? and platform_uid=?",
            [platform, platformUid]
        );
        if (result.length < 1) {
            return null;
        }
        return result[0];
    }

    async getUserByID(uid: string): Promise<UserInfo | null> {
        const result = await this.query("select * from t_user where uid=?", [
            uid,
        ]);
        if (result.length < 1) {
            return null;
        }
        return _userInfoSchema.parse(result[0]);
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
        const result = await this.query("select * from t_node where f_id=?", [
            nodeId,
        ]);
        if (result.length < 1) {
            return null;
        }
        return _nodeInfoSchema.parse(result[0]);
    }

    async createNodeInfo(
        cluster: string,
        nodeId: string,
        nodeName: string,
        publicSignKey: string,
        publicSignKeyHash: string,
        config: string
    ) {
        await this.insert("t_node", {
            f_cluster: cluster,
            f_node_id: nodeId,
            f_node_name: nodeName,
            f_public_sign_key: publicSignKey,
            f_public_sign_key_hash: publicSignKeyHash,
            f_config: config,
        });
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
