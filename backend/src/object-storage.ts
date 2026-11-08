import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { Client } from "minio";
import { z } from "zod";
import { storageConnectionRequestSchema, storageConnectionSummarySchema, type StorageConnectionRequest, type StorageConnectionSummary, type StorageSettings } from "@veriqorn/contracts";

import type { AppConfig } from "./config";
import { HttpError } from "./errors";

export const STORAGE_SETTINGS_KEY = "objectStorageConfig";
export const LEGACY_STORAGE_ID = "legacy-minio";
const categories = ["artifacts", "traces", "screenshots"] as const;
type StorageClient = Pick<Client, "bucketExists" | "makeBucket" | "putObject" | "getObject" | "removeObject">;
type ClientOptions = ConstructorParameters<typeof Client>[0];
export type StorageSettingsStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};
export type StorageMutation = <T>(action: (store: StorageSettingsStore) => Promise<T>) => Promise<T>;
export type ObjectLocation = {
  storageType: "minio" | "s3";
  storageConnectionId: string | null;
  storageBucket: string;
  objectKey: string;
};
const storedConnectionSchema = storageConnectionSummarySchema.extend({ credentials: z.string() });
type StoredConnection = z.infer<typeof storedConnectionSchema>;
const stateSchema = z.object({
  version: z.literal(1),
  activeConnectionId: z.string().nullable(),
  connections: z.array(storedConnectionSchema),
});
type State = z.infer<typeof stateSchema>;

const createClient = (options: ClientOptions): StorageClient => new Client({
  ...options,
  transportAgent: options.useSSL === false
    ? new HttpAgent({ keepAlive: false, timeout: 30_000 })
    : new HttpsAgent({ keepAlive: false, timeout: 30_000 }),
});

export class ObjectStorageService {
  private readonly legacy: StorageClient | null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: AppConfig,
    private readonly store: StorageSettingsStore,
    private readonly clientFactory: (options: ClientOptions) => StorageClient = createClient,
    private readonly transaction?: StorageMutation,
  ) {
    this.legacy = config.minioEnabled ? clientFactory({
      endPoint: config.minioEndpoint, port: config.minioPort, useSSL: config.minioUseSsl,
      accessKey: config.minioAccessKey, secretKey: config.minioSecretKey,
    }) : null;
  }

  private async load(store = this.store): Promise<State> {
    const raw = await store.get(STORAGE_SETTINGS_KEY);
    if (!raw) return { version: 1, activeConnectionId: this.legacy ? LEGACY_STORAGE_ID : null, connections: [] };
    try { return stateSchema.parse(JSON.parse(raw)); } catch {
      throw new HttpError(503, "STORAGE_CONFIG_INVALID", "Stored object storage settings are invalid");
    }
  }

  private mutate<T>(action: (state: State) => Promise<T>): Promise<T> {
    const execute = async (store: StorageSettingsStore) => {
      const state = await this.load(store);
      const result = await action(state);
      await store.set(STORAGE_SETTINGS_KEY, JSON.stringify(state));
      return result;
    };
    // Production supplies a PostgreSQL advisory transaction lock, shared by
    // all backend replicas. The queue also makes standalone adapters safe.
    const pending = this.mutationQueue.then(() => this.transaction ? this.transaction(execute) : execute(this.store));
    this.mutationQueue = pending.catch(() => undefined);
    return pending;
  }

  private encryptionKey(): Buffer {
    const raw = this.config.storageEncryptionKey;
    const key = raw ? Buffer.from(raw, "base64url") : null;
    if (!key || key.length !== 32) {
      throw new HttpError(503, "STORAGE_ENCRYPTION_KEY_REQUIRED", "Configure VERIQORN_STORAGE_ENCRYPTION_KEY with a 32-byte base64url key on the backend before saving storage credentials");
    }
    return key;
  }

  private encrypt(id: string, credentials: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(credentials, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(":");
  }

  private client(connection: StoredConnection): StorageClient {
    const key = this.encryptionKey();
    try {
      const [version, iv, ciphertext, tag] = connection.credentials.split(":");
      if (version !== "v1") throw new Error("Invalid ciphertext version");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(connection.id));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const credentials = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
      const endpoint = new URL(connection.endpoint);
      return this.clientFactory({
        endPoint: endpoint.hostname, port: Number(endpoint.port) || (endpoint.protocol === "https:" ? 443 : 80),
        useSSL: endpoint.protocol === "https:", region: connection.region,
        accessKey: credentials.accessKey, secretKey: credentials.secretKey, sessionToken: credentials.sessionToken,
        pathStyle: connection.provider === "minio",
      });
    } catch {
      throw new HttpError(503, "STORAGE_CREDENTIALS_UNAVAILABLE", "Storage credentials cannot be decrypted; check the backend encryption key");
    }
  }

  private summary(connection: StoredConnection): StorageConnectionSummary {
    return storageConnectionSummarySchema.parse(connection);
  }

  async getSettings(): Promise<StorageSettings> {
    const state = await this.load();
    const connections = state.connections.map(connection => this.summary(connection));
    if (this.legacy) connections.unshift({
      id: LEGACY_STORAGE_ID, name: "Installation MinIO", provider: "minio", legacy: true,
      endpoint: `${this.config.minioUseSsl ? "https" : "http"}://${this.config.minioEndpoint}:${this.config.minioPort}`,
      region: "us-east-1", bucket: null, prefix: "", createdAt: null, lastCheckedAt: null,
    });
    return {
      activeConnectionId: state.activeConnectionId,
      credentialsEncryptionConfigured: Boolean(this.config.storageEncryptionKey && Buffer.from(this.config.storageEncryptionKey, "base64url").length === 32),
      connections,
    };
  }

  async addConnection(input: StorageConnectionRequest): Promise<StorageConnectionSummary> {
    const parsed = storageConnectionRequestSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, "STORAGE_VALIDATION", "Invalid storage connection parameters");
    const value = parsed.data;
    let endpoint: URL;
    if (value.provider === "s3") {
      endpoint = new URL(`https://s3.${value.region}.${value.region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"}`);
    } else {
      endpoint = new URL(value.endpoint);
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash
        || /^(?:169\.254\.|\[?fe80:)/i.test(endpoint.hostname) || endpoint.hostname === "metadata.google.internal") {
        throw new HttpError(400, "STORAGE_ENDPOINT_INVALID", "MinIO endpoint must be an HTTP(S) server URL without a path or embedded credentials");
      }
    }
    const id = randomUUID();
    const connection: StoredConnection = {
      id, name: value.name, provider: value.provider, endpoint: endpoint.origin,
      region: value.region, bucket: value.bucket, prefix: value.prefix.replace(/^\/+|\/+$/g, ""),
      legacy: false, createdAt: new Date().toISOString(), lastCheckedAt: null,
      credentials: this.encrypt(id, JSON.stringify({ accessKey: value.accessKey, secretKey: value.secretKey, sessionToken: value.sessionToken })),
    };
    return this.mutate(async state => {
      if (state.connections.length >= 100) throw new HttpError(409, "STORAGE_CONNECTION_LIMIT", "The installation already has 100 storage connections");
      state.connections.push(connection);
      return this.summary(connection);
    });
  }

  private findConnection(state: State, id: string): StoredConnection {
    const connection = state.connections.find(entry => entry.id === id);
    if (!connection) throw new HttpError(404, "STORAGE_CONNECTION_NOT_FOUND", "Storage connection not found");
    return connection;
  }

  private async probe(client: StorageClient, bucket: string, prefix: string): Promise<void> {
    const key = [prefix, ".veriqorn-check", randomUUID()].filter(Boolean).join("/");
    const payload = randomBytes(32);
    try {
      await client.putObject(bucket, key, payload, payload.length, { "Content-Type": "application/octet-stream" });
      const stream = await client.getObject(bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      if (!Buffer.concat(chunks).equals(payload)) throw new Error("Storage returned different content");
    } finally {
      // Deletion permission is part of the check. A failed check never activates
      // this destination, and SDK errors/credentials never reach API responses.
      await client.removeObject(bucket, key);
    }
  }

  private async check(state: State, id: string): Promise<string> {
    try {
      if (id === LEGACY_STORAGE_ID) {
        if (!this.legacy) throw new HttpError(404, "STORAGE_CONNECTION_NOT_FOUND", "Installation MinIO is disabled");
        for (const bucket of categories) await this.probe(this.legacy, bucket, "");
      } else {
        const connection = this.findConnection(state, id);
        await this.probe(this.client(connection), connection.bucket!, connection.prefix);
      }
      return new Date().toISOString();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "STORAGE_CONNECTION_CHECK_FAILED", "Storage check failed. Verify the endpoint, region, bucket, credentials, and object read/write/delete permissions. A test object may need cleanup under .veriqorn-check.");
    }
  }

  async checkConnection(id: string): Promise<{ checkedAt: string }> {
    const state = await this.load();
    const checkedAt = await this.check(state, id);
    if (id !== LEGACY_STORAGE_ID) await this.mutate(async latest => { this.findConnection(latest, id).lastCheckedAt = checkedAt; });
    return { checkedAt };
  }

  async activateConnection(id: string): Promise<{ activeConnectionId: string }> {
    // Validate outside the database transaction; destinations are immutable.
    const checkedAt = await this.check(await this.load(), id);
    return this.mutate(async state => {
      if (id !== LEGACY_STORAGE_ID) this.findConnection(state, id).lastCheckedAt = checkedAt;
      state.activeConnectionId = id;
      return { activeConnectionId: id };
    });
  }

  async initialize(): Promise<void> {
    // An S3-only deployment must not contact legacy MinIO during startup.
    if ((await this.load()).activeConnectionId !== LEGACY_STORAGE_ID || !this.legacy) return;
    for (const bucket of categories) {
      if (!await this.legacy.bucketExists(bucket)) await this.legacy.makeBucket(bucket);
    }
  }

  async isAvailable(): Promise<boolean> {
    return (await this.load()).activeConnectionId !== null;
  }

  async uploadBuffer(category: string, objectName: string, buffer: Buffer, contentType: string): Promise<ObjectLocation> {
    const state = await this.load();
    const id = state.activeConnectionId;
    if (!id) throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "No object storage connection is active");
    const connection = id === LEGACY_STORAGE_ID ? null : this.findConnection(state, id);
    const client = connection ? this.client(connection) : this.legacy;
    if (!client) throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "The active storage connection is unavailable");
    const location: ObjectLocation = {
      storageType: connection?.provider ?? "minio", storageConnectionId: connection?.id ?? null,
      storageBucket: connection?.bucket ?? category,
      objectKey: connection ? [connection.prefix, category, objectName].filter(Boolean).join("/") : objectName,
    };
    await client.putObject(location.storageBucket, location.objectKey, buffer, buffer.length, { "Content-Type": contentType });
    return location;
  }

  private async readClient(connectionId?: string | null): Promise<StorageClient | null> {
    // NULL is always legacy MinIO, never whichever connection is active now.
    return connectionId && connectionId !== LEGACY_STORAGE_ID
      ? this.client(this.findConnection(await this.load(), connectionId)) : this.legacy;
  }

  async getFile(bucket: string, objectKey: string, connectionId?: string | null): Promise<Buffer | null> {
    const client = await this.readClient(connectionId);
    if (!client) return null;
    try {
      const stream = await client.getObject(bucket, objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch (error) {
      if (["NoSuchKey", "NoSuchBucket", "NotFound"].includes(String(error?.code))) return null;
      throw new HttpError(502, "STORAGE_READ_FAILED", "Cannot read the attachment from its storage connection");
    }
  }

  async deleteFile(bucket: string, objectKey: string, connectionId?: string | null): Promise<void> {
    const client = await this.readClient(connectionId);
    if (!client) throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "The attachment's storage connection is unavailable");
    await client.removeObject(bucket, objectKey);
  }
}
