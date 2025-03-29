import z from "zod";
import { CreateServiceToken, CheckServiceToken } from "./token";

const _joinClusterTokenSchema = z.object({
    type: z.literal("join"),
    clusterId: z.number(),
    createUserId: z.number(),
});

export function CreateJoinClusterToken(
    clusterId: number,
    createUserId: number
) {
    return CreateServiceToken(
        {
            type: "join",
            clusterId,
            createUserId,
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
            return tokenData;
        }
    }

    return null;
}
