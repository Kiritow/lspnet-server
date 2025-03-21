import { BaseDaoClass } from "./base-dao";
import { _nodeInfoSchema, _userInfoSchema, NodeInfo, UserInfo } from "./model";

export class DaoClass extends BaseDaoClass {
    async getPlatformUser(platform: string, platformUid: string) {
        const result = await this.query(
            "select * from users where platform=? and platform_uid=?",
            [platform, platformUid]
        );
        if (result.length < 1) {
            return null;
        }
        return result[0];
    }

    async getUserByID(uid: string): Promise<UserInfo | null> {
        const result = await this.query("select * from users where uid=?", [
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
}
