import { assert } from "./common";
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
    validUntil: number;
    privateSignKey: crypto.KeyObject;
    signKeyHash: Buffer;
    peerPublicSignKey: crypto.KeyObject;
    peerSignKeyHash: Buffer;
    sharedSecret: Buffer;

    constructor(
        connId: number,
        validUntil: number,
        privateSignKey: crypto.KeyObject,
        signKeyHash: Buffer,
        peerPublicSignKey: crypto.KeyObject,
        peerSignKeyHash: Buffer,
        sharedSecret: Buffer
    ) {
        this.connId = connId;
        this.validUntil = validUntil;
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
    data: Buffer;
}

export interface SecureSessionStore {
    get(connId: number): Promise<SecureSession | undefined>;
    has(connId: number): Promise<boolean>;
    set(connId: number, session: SecureSession): Promise<void>;
    push(session: SecureSession): Promise<number>;
    delete(connId: number): Promise<void>;
}

class SecureSessionMemoryStore implements SecureSessionStore {
    sessions: Map<number, SecureSession>;
    timer: NodeJS.Timeout;

    constructor(cleanupIntervalMs: number = 300000) {
        this.sessions = new Map();

        const refThis = new WeakRef(this);
        this.timer = setInterval(() => {
            const obj = refThis.deref();
            if (obj === undefined) {
                clearInterval(this.timer);
                return;
            }

            const now = Date.now();
            for (const [connId, session] of obj.sessions) {
                if (session.validUntil < now) {
                    obj.sessions.delete(connId);
                }
            }
        }, cleanupIntervalMs); // run every 5 minutes
    }

    async get(connId: number): Promise<SecureSession | undefined> {
        return this.sessions.get(connId);
    }

    async has(connId: number): Promise<boolean> {
        return this.sessions.has(connId);
    }

    async set(connId: number, session: SecureSession): Promise<void> {
        this.sessions.set(connId, session);
    }

    async push(session: SecureSession): Promise<number> {
        let cid: number = 0;
        for (;;) {
            cid = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
            if (cid !== 0 && !this.sessions.has(cid)) {
                break;
            }
        }
        this.sessions.set(cid, session);
        session.connId = cid;
        return cid;
    }

    async delete(connId: number): Promise<void> {
        this.sessions.delete(connId);
    }
}

export class SecureChannelServer {
    privateSignKey: crypto.KeyObject;
    signKeyHash: Buffer;
    clientPublicSignKeyLoader: (keyName: string) => Promise<crypto.KeyObject>;
    connections: SecureSessionStore;

    constructor(
        privateSignKey: crypto.KeyObject,
        loader: (keyName: string) => Promise<crypto.KeyObject>,
        store?: SecureSessionStore
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
        this.clientPublicSignKeyLoader = loader;
        this.connections = store || new SecureSessionMemoryStore();
    }

    async createSession(
        keyName: string,
        clientPublicEccKeyRaw: Buffer,
        clientPublicEccKeySign: Buffer,
        eccKeyDeserializer: (raw: Buffer) => crypto.KeyObject,
        sessionDurationMs: number = 1000 * 60 * 60 // 1 hour
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

        const validUntil = Date.now() + sessionDurationMs;
        const session = new SecureSession(
            0,
            validUntil,
            this.privateSignKey,
            this.signKeyHash,
            clientPublicSignKey,
            getPublicKeyHash(clientPublicSignKey),
            sharedSecret
        );
        const cid = await this.connections.push(session);
        console.log(session);

        const payload = session.encryptSync(
            Buffer.from(
                JSON.stringify({
                    iat: Date.now(),
                    exp: validUntil,
                })
            )
        );

        const publicKeyRaw = getPublicKeyRaw(publicKey);
        const signBuffer = Buffer.concat([publicKeyRaw, int64Tobuffer(cid)]);
        const sign = crypto.sign(null, signBuffer, this.privateSignKey);
        return {
            publicKey: publicKeyRaw,
            connId: cid,
            sign,
            data: payload.toBuffer(),
            session,
        };
    }

    getSession(connId: number): Promise<SecureSession | undefined> {
        return this.connections.get(connId);
    }
}
