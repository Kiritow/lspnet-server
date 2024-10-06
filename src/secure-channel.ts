import assert from "assert";
import crypto from "crypto";

export function getPublicKeyHash(publicKey: crypto.KeyObject): Buffer {
    assert(
        publicKey.type === "public" &&
            (publicKey.asymmetricKeyType == "x25519" ||
                publicKey.asymmetricKeyType == "ed25519"),
        "unsupported key type"
    );
    const der = publicKey.export({ type: "spki", format: "der" });
    const rawKey = der.subarray(der.length - 32);
    return crypto.createHash("sha256").update(rawKey).digest();
}

export class SecureMessage {
    senderKeyId: string;
    recvKeyId: string;
    salt: Buffer;
    cipherText: Buffer;
    nonce: Buffer;
    tag: Buffer;
    timestamp: number;
    signature: Buffer;

    constructor(
        senderKeyId: string,
        recvKeyId: string,
        salt: Buffer,
        cipherText: Buffer,
        nonce: Buffer,
        tag: Buffer,
        timestamp: number,
        signature: Buffer
    ) {
        this.senderKeyId = senderKeyId;
        this.recvKeyId = recvKeyId;
        this.salt = salt;
        this.cipherText = cipherText;
        this.nonce = nonce;
        this.tag = tag;
        this.timestamp = timestamp;
        this.signature = signature;
    }

    toBuffer(): Buffer {
        const tbuf = Buffer.allocUnsafe(4);
        tbuf.writeUInt32BE(this.timestamp);

        return Buffer.concat([
            this.signature,
            Buffer.from(this.senderKeyId, "hex"),
            Buffer.from(this.recvKeyId, "hex"),
            this.salt,
            this.nonce,
            this.tag,
            tbuf,
            this.cipherText,
        ]);
    }
}

export function parseSecureMessage(buffer: Buffer): SecureMessage {
    const signature = buffer.subarray(0, 64);
    const senderKeyId = buffer.subarray(64, 96).toString("hex");
    const recvKeyId = buffer.subarray(96, 128).toString("hex");
    const salt = buffer.subarray(128, 160);
    const nonce = buffer.subarray(160, 172);
    const tag = buffer.subarray(172, 188);
    const timestamp = buffer.readUInt32BE(188);
    const cipherText = buffer.subarray(192);

    return new SecureMessage(
        senderKeyId,
        recvKeyId,
        salt,
        cipherText,
        nonce,
        tag,
        timestamp,
        signature
    );
}

export class SecureChannel {
    privateSignKey: crypto.KeyObject;
    peerPublicSignKey: crypto.KeyObject;
    signKeyHash: Buffer;
    peerSignKeyHash: Buffer;
    localEccKeys: Map<string, crypto.KeyObject> = new Map(); // private ecc keys
    remoteEccKeys: Map<string, crypto.KeyObject> = new Map(); // public ecc keys

    constructor(
        privateSignKey: crypto.KeyObject,
        peerPublicSignKey: crypto.KeyObject
    ) {
        this.privateSignKey = privateSignKey;
        this.peerPublicSignKey = peerPublicSignKey;
        assert(
            this.privateSignKey.type === "private" &&
                this.privateSignKey.asymmetricKeyType === "ed25519",
            "invalid private sign key"
        );
        assert(
            this.peerPublicSignKey.type === "public" &&
                this.peerPublicSignKey.asymmetricKeyType === "ed25519",
            "public key required"
        );

        this.signKeyHash = getPublicKeyHash(
            crypto.createPublicKey(this.privateSignKey)
        );
        this.peerSignKeyHash = getPublicKeyHash(this.peerPublicSignKey);
    }

    _deriveAESKeySync(
        localEccKeyId: string,
        remoteEccKeyId: string,
        salt: Buffer
    ): ArrayBuffer {
        const localEccKey = this.localEccKeys.get(localEccKeyId);
        const remoteEccKey = this.remoteEccKeys.get(remoteEccKeyId);
        assert(localEccKey, "local ecc key not found");
        assert(remoteEccKey, "remote ecc key not found");

        const sharedSecret = crypto.diffieHellman({
            privateKey: localEccKey,
            publicKey: remoteEccKey,
        });

        return crypto.hkdfSync(
            "sha256",
            sharedSecret,
            salt,
            Buffer.from("SecureChannelv1"),
            32
        );
    }

    _encryptSync(
        localEccKeyId: string,
        remoteEccKeyId: string,
        plaintext: Buffer
    ): SecureMessage {
        const salt = crypto.randomBytes(32);
        const aesKeyBytes = this._deriveAESKeySync(
            localEccKeyId,
            remoteEccKeyId,
            salt
        );
        const aesKey = crypto.createSecretKey(Buffer.from(aesKeyBytes));
        const iv = crypto.randomBytes(12);

        const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
        cipher.setAAD(this.signKeyHash);
        const encrypted = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();

        const timestamp = Math.floor(Date.now() / 1000);
        const tbuf = Buffer.allocUnsafe(4);
        tbuf.writeUInt32BE(timestamp);

        const signBuffer = Buffer.concat([
            Buffer.from(localEccKeyId, "hex"),
            Buffer.from(remoteEccKeyId, "hex"),
            salt,
            encrypted,
            iv,
            tag,
            tbuf,
        ]);

        const signature = crypto.sign(null, signBuffer, this.privateSignKey);

        return new SecureMessage(
            localEccKeyId,
            remoteEccKeyId,
            salt,
            encrypted,
            iv,
            tag,
            timestamp,
            signature
        );
    }

    encryptSync(plaintext: Buffer): SecureMessage {
        const localEccKeyId = Array.from(this.localEccKeys.keys())[
            Math.floor(Math.random() * this.localEccKeys.size)
        ];
        const remoteEccKeyId = Array.from(this.remoteEccKeys.keys())[
            Math.floor(Math.random() * this.remoteEccKeys.size)
        ];
        return this._encryptSync(localEccKeyId, remoteEccKeyId, plaintext);
    }

    decryptSync(message: SecureMessage): Buffer {
        const tbuf = Buffer.allocUnsafe(4);
        tbuf.writeUInt32BE(message.timestamp);

        // verify sign
        const signBuffer = Buffer.concat([
            Buffer.from(message.senderKeyId, "hex"),
            Buffer.from(message.recvKeyId, "hex"),
            message.salt,
            message.cipherText,
            message.nonce,
            message.tag,
            tbuf,
        ]);

        console.log(signBuffer.toString("hex"));

        const verified = crypto.verify(
            null,
            signBuffer,
            this.peerPublicSignKey,
            message.signature
        );

        if (!verified) {
            throw new Error("signature verification failed");
        }

        // decrypt
        const aesKeyBytes = this._deriveAESKeySync(
            message.recvKeyId,
            message.senderKeyId,
            message.salt
        );
        const aesKey = crypto.createSecretKey(Buffer.from(aesKeyBytes));
        const cipher = crypto.createDecipheriv(
            "aes-256-gcm",
            aesKey,
            message.nonce
        );
        cipher.setAAD(this.peerSignKeyHash);
        cipher.setAuthTag(message.tag);
        const plaintext = Buffer.concat([
            cipher.update(message.cipherText),
            cipher.final(),
        ]);

        return plaintext;
    }

    sign(buffer: Buffer): Buffer {
        return crypto.sign(null, buffer, this.privateSignKey);
    }

    validate(buffer: Buffer, signature: Buffer): boolean {
        return crypto.verify(null, buffer, this.peerPublicSignKey, signature);
    }
}
