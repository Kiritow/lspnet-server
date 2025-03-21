import crypto from "crypto";
import assert from "assert";

export class ClientKeyWrapper {
    private keyObject: crypto.KeyObject;
    private derHash: string;

    constructor(publicKeyPEM: string) {
        this.keyObject = crypto.createPublicKey({
            key: publicKeyPEM,
            format: "pem",
            encoding: "utf-8",
        });
        assert(this.keyObject.type === "public");
        assert(this.keyObject.asymmetricKeyType === "ed25519");

        this.derHash = crypto
            .createHash("sha256")
            .update(this.keyObject.export({ type: "spki", format: "der" }))
            .digest("hex");
    }

    getKeyHash() {
        return this.derHash;
    }

    checkSignature(data: Buffer, signature: Buffer) {
        const verified = crypto.verify(null, data, this.keyObject, signature);
        return verified;
    }

    toPEM() {
        const pemString = this.keyObject.export({
            type: "spki",
            format: "pem",
        });
        assert(typeof pemString === "string");
        return pemString;
    }
}
