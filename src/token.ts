import z from "zod";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { GetServiceTokenKeysSync } from "./credentials";

// Generate new key with crypto.randomBytes(32).toString('hex')
const serviceKeys = GetServiceTokenKeysSync().map((k) => Buffer.from(k, "hex"));

export const _serviceTokenBaseSchema = z.object({
    iat: z.number(),
    exp: z.number(),
    data: z.unknown().refine((data) => data !== null && data !== undefined),
});

export type ServiceTokenDataBase = z.infer<typeof _serviceTokenBaseSchema>;

export function CreateServiceToken(data: unknown, expireSeconds: number) {
    if (data === null || data === undefined)
        throw Error("token data cannot be null");

    const tokenInfo = {
        data,
        iat: Math.floor(new Date().getTime() / 1000),
        exp: Math.floor(new Date().getTime() / 1000) + expireSeconds,
    };

    const realData = Buffer.from(JSON.stringify(tokenInfo), "utf-8");
    const iv = randomBytes(16);
    const keyIndex = Math.floor(Math.random() * serviceKeys.length);
    const key = serviceKeys[keyIndex];

    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const resultBuffer = Buffer.concat([
        cipher.update(realData),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${resultBuffer.toString("base64")}.${keyIndex}.${iv.toString("base64")}.${authTag.toString("base64")}`;
}

export function CheckServiceToken(
    token: string,
    mustCreateAfterTs?: number
): ServiceTokenDataBase | null {
    try {
        const parts = token.split(".");
        if (parts.length != 4) {
            console.log(`invalid or malformed token: ${token}`);
            return null;
        }

        const edata = Buffer.from(parts[0], "base64");
        const keyIndex = parseInt(parts[1], 10);
        const iv = Buffer.from(parts[2], "base64");
        const authTag = Buffer.from(parts[3], "base64");

        const key = serviceKeys[keyIndex];
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);

        const resultBuffer = Buffer.concat([
            decipher.update(edata),
            decipher.final(),
        ]);

        const tokenInfo = _serviceTokenBaseSchema.parse(
            JSON.parse(resultBuffer.toString("utf-8"))
        );
        if (tokenInfo.exp <= Math.floor(new Date().getTime() / 1000)) {
            console.log(`token expired: ${token}`);
            return null;
        }

        if (
            mustCreateAfterTs !== undefined &&
            tokenInfo.iat < Math.floor(mustCreateAfterTs / 1000)
        ) {
            console.log(
                `token create time invalid, require: ${new Date(mustCreateAfterTs).toISOString()}, got: ${new Date(tokenInfo.iat * 1000)}`
            );
            return null;
        }

        return tokenInfo;
    } catch (e) {
        console.log(e);
        console.log(`invalid token: ${token}`);
        return null;
    }
}
