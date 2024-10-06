import assert from "assert";
import crypto from "crypto";

export function getPublicKeyHash(publicKey: crypto.KeyObject): Buffer {
    return crypto
        .createHash("sha256")
        .update(getPublicKeyRaw(publicKey))
        .digest();
}

export function getPublicKeyRaw(publicKey: crypto.KeyObject): Buffer {
    assert(
        publicKey.type === "public" &&
            (publicKey.asymmetricKeyType == "x25519" ||
                publicKey.asymmetricKeyType == "ed25519"),
        "unsupported key type"
    );
    const der = publicKey.export({ type: "spki", format: "der" });
    return der.subarray(der.length - 32);
}

function int64Tobuffer(num: number): Buffer {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUint64BE(BigInt(num));
    return buf;
}

export class SecureMessage {
    connId: number; // 64-bit (8 bytes)
    timestamp: number; // 64-bit (8 bytes), milliseconds
    salt: Buffer; // 32 bytes
    cipherText: Buffer;
    nonce: Buffer; // 12 bytes
    tag: Buffer; // 16 bytes
    signature: Buffer; // 64 bytes

    constructor(
        connId: number,
        timestamp: number,
        salt: Buffer,
        cipherText: Buffer,
        nonce: Buffer,
        tag: Buffer,
        signature: Buffer
    ) {
        this.connId = connId;
        this.timestamp = timestamp;
        this.salt = salt;
        this.cipherText = cipherText;
        this.nonce = nonce;
        this.tag = tag;
        this.signature = signature;
    }

    _signBuffer(): Buffer {
        return Buffer.concat([
            int64Tobuffer(this.connId),
            int64Tobuffer(this.timestamp),
            this.salt,
            this.nonce,
            this.tag,
            this.cipherText,
        ]);
    }

    toBuffer(): Buffer {
        return Buffer.concat([
            this.signature,
            int64Tobuffer(this.connId),
            int64Tobuffer(this.timestamp),
            this.salt,
            this.nonce,
            this.tag,
            this.cipherText,
        ]);
    }

    static fromBuffer(buffer: Buffer): SecureMessage {
        const signature = buffer.subarray(0, 64);
        const connId = buffer.readBigUInt64BE(64);
        const timestamp = buffer.readBigUInt64BE(72);
        const salt = buffer.subarray(80, 112);
        const nonce = buffer.subarray(112, 124);
        const tag = buffer.subarray(124, 140);
        const cipherText = buffer.subarray(140);

        return new SecureMessage(
            Number(connId),
            Number(timestamp),
            salt,
            cipherText,
            nonce,
            tag,
            signature
        );
    }
}

export class SecureSession {
    connId: number;
    privateSignKey: crypto.KeyObject;
    signKeyHash: Buffer;
    peerPublicSignKey: crypto.KeyObject;
    peerSignKeyHash: Buffer;
    sharedSecret: Buffer;

    constructor(
        connId: number,
        privateSignKey: crypto.KeyObject,
        signKeyHash: Buffer,
        peerPublicSignKey: crypto.KeyObject,
        peerSignKeyHash: Buffer,
        sharedSecret: Buffer
    ) {
        this.connId = connId;
        this.privateSignKey = privateSignKey;
        this.signKeyHash = signKeyHash;
        this.peerPublicSignKey = peerPublicSignKey;
        this.peerSignKeyHash = peerSignKeyHash;
        this.sharedSecret = sharedSecret;
    }

    encryptSync(plaintext: Buffer): SecureMessage {
        const salt = crypto.randomBytes(32);
        const aesKeyBytes = crypto.hkdfSync(
            "sha256",
            this.sharedSecret,
            salt,
            Buffer.from("SecureChannelv1"),
            32
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

        const message = new SecureMessage(
            this.connId,
            Date.now(),
            salt,
            encrypted,
            iv,
            tag,
            Buffer.alloc(0)
        );
        message.signature = crypto.sign(
            null,
            message._signBuffer(),
            this.privateSignKey
        );
        return message;
    }

    decryptSync(message: SecureMessage): Buffer {
        const verified = crypto.verify(
            null,
            message._signBuffer(),
            this.peerPublicSignKey,
            message.signature
        );
        if (!verified) {
            throw new Error("signature verification failed");
        }
        assert(message.connId === this.connId, "invalid connection id");

        const aesKeyBytes = crypto.hkdfSync(
            "sha256",
            this.sharedSecret,
            message.salt,
            Buffer.from("SecureChannelv1"),
            32
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
}

export interface CreateSessionResult {
    session: SecureSession;
    connId: number;
    publicKey: Buffer;
    sign: Buffer;
}

export class SecureChannelServer {
    privateSignKey: crypto.KeyObject;
    signKeyHash: Buffer;
    clientPublicSignKeyLoader: (keyName: string) => Promise<crypto.KeyObject>;
    connections: Map<number, SecureSession>;

    constructor(
        privateSignKey: crypto.KeyObject,
        loader: (keyName: string) => Promise<crypto.KeyObject>
    ) {
        this.privateSignKey = privateSignKey;
        assert(
            this.privateSignKey.type === "private" &&
                this.privateSignKey.asymmetricKeyType === "ed25519",
            "invalid private sign key"
        );
        this.signKeyHash = getPublicKeyHash(
            crypto.createPublicKey(this.privateSignKey)
        );
        this.connections = new Map();
        this.clientPublicSignKeyLoader = loader;
    }

    _newConnectionId(): number {
        for (;;) {
            const cid = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
            if (cid !== 0 && !this.connections.has(cid)) {
                return cid;
            }
        }
    }

    async createSession(
        keyName: string,
        clientPublicEccKeyRaw: Buffer,
        clientPublicEccKeySign: Buffer,
        eccKeyDeserializer: (raw: Buffer) => crypto.KeyObject
    ): Promise<CreateSessionResult> {
        const clientPublicSignKey =
            await this.clientPublicSignKeyLoader(keyName);
        assert(
            clientPublicSignKey.type === "public" &&
                clientPublicSignKey.asymmetricKeyType === "ed25519",
            "invalid client sign key"
        );

        const verified = crypto.verify(
            null,
            clientPublicEccKeyRaw,
            clientPublicSignKey,
            clientPublicEccKeySign
        );
        if (!verified) {
            throw new Error("signature verification failed");
        }

        const clientPublicEccKey = eccKeyDeserializer(clientPublicEccKeyRaw);
        assert(
            clientPublicEccKey.type === "public" &&
                clientPublicEccKey.asymmetricKeyType === "x25519",
            "invalid ecc key"
        );

        const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
        const sharedSecret = crypto.diffieHellman({
            privateKey,
            publicKey: clientPublicEccKey,
        });
        const cid = this._newConnectionId();
        const session = new SecureSession(
            cid,
            this.privateSignKey,
            this.signKeyHash,
            clientPublicSignKey,
            getPublicKeyHash(clientPublicSignKey),
            sharedSecret
        );
        this.connections.set(cid, session);

        const publicKeyRaw = getPublicKeyRaw(publicKey);
        const signBuffer = Buffer.concat([publicKeyRaw, int64Tobuffer(cid)]);
        const sign = crypto.sign(null, signBuffer, this.privateSignKey);
        return {
            publicKey: publicKeyRaw,
            connId: cid,
            sign,
            session,
        };
    }

    getSession(connId: number): SecureSession | undefined {
        return this.connections.get(connId);
    }
}
