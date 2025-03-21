import z from "zod";
import { CreateServiceToken, CheckServiceToken } from "./token";

const _joinClusterTokenSchema = z.object({
    type: z.literal("join"),
    cluster: z.string(),
});

export function CreateJoinClusterToken(cluster: string) {
    return CreateServiceToken(
        {
            type: "join",
            cluster,
        },
        180
    );
}

export function CheckJoinClusterToken(token: string) {
    const tokenInfo = CheckServiceToken(token);
    if (tokenInfo != null) {
        const parseResult = _joinClusterTokenSchema.safeParse(tokenInfo.data);
        if (!parseResult.success) {
            return null;
        }
        const tokenData = parseResult.data;
        if (tokenData.type == "join") {
            return tokenData.cluster;
        }
    }

    return null;
}
