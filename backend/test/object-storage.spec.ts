import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import type { Client } from "minio";
import { ObjectStorageService, LEGACY_STORAGE_ID, STORAGE_SETTINGS_KEY } from "../src/object-storage";
import { createProjectScopedServices, createTestApp, createTestConfig, defaultAuthUser } from "./test-helpers";
import type { AppServices } from "../src/services";
import type { StorageConnectionRequest } from "@veriqorn/contracts";

const input: StorageConnectionRequest = {
  name: "AWS production", provider: "s3", region: "eu-west-1", bucket: "veriqorn-tests",
  prefix: "evidence", accessKey: "test-access-key", secretKey: "test-secret-key", sessionToken: "test-session-token",
};

function harness(encryption = true) {
  const values = new Map<string, string>();
  const objects = new Map<string, Buffer>();
  const options: Array<ConstructorParameters<typeof Client>[0]> = [];
  let failing = false;
  let corrupt = false;
  let beforeUpload: ((key: string) => Promise<void>) | undefined;
  const config = createTestConfig({ minioEnabled: true, storageEncryptionKey: encryption ? Buffer.alloc(32, 7).toString("base64url") : undefined });
  const store = { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); } };
  const factory = (option: ConstructorParameters<typeof Client>[0]) => {
    options.push(option);
    const key = (bucket: string, object: string) => `${option.endPoint}/${bucket}/${object}`;
    return {
      bucketExists: async () => true,
      makeBucket: async () => { throw new Error("Should use existing buckets"); },
      putObject: async (bucket: string, object: string, buffer: Buffer) => {
        await beforeUpload?.(object);
        if (failing) throw new Error("AccessDenied: test-secret-key");
        objects.set(key(bucket, object), Buffer.from(buffer));
      },
      getObject: async (bucket: string, object: string) => {
        if (failing) throw new Error("AccessDenied: test-secret-key");
        const content = objects.get(key(bucket, object));
        if (!content) throw Object.assign(new Error("Missing object"), { code: "NoSuchKey" });
        return Readable.from([corrupt ? Buffer.from("corrupted") : content]);
      },
      removeObject: async (bucket: string, object: string) => {
        if (failing) throw new Error("AccessDenied: test-secret-key");
        objects.delete(key(bucket, object));
      },
    } as unknown as Client;
  };
  const service = new ObjectStorageService(config, store, factory);
  return { service, values, objects, options, store, config, factory,
    fail: (value: boolean) => { failing = value; }, corrupt: (value: boolean) => { corrupt = value; },
    beforeUpload: (value: (key: string) => Promise<void>) => { beforeUpload = value; },
  };
}

describe("configurable object storage", () => {
  it("performs signed write/read/delete operations with the real SDK", async () => {
    const objects = new Map<string, Buffer>();
    const signatures: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const key = new URL(request.url).pathname;
      signatures.push(request.headers.get("authorization") ?? "");
      if (request.method === "PUT") {
        objects.set(key, Buffer.from(await request.arrayBuffer()));
        return new Response(null, { headers: { etag: '"test-etag"' } });
      }
      if (request.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
      const content = objects.get(key);
      return new Response(content ? new Uint8Array(content) : null, { headers: { "content-type": "application/octet-stream" } });
    } });
    const values = new Map<string, string>();
    const storage = new ObjectStorageService(createTestConfig({ storageEncryptionKey: Buffer.alloc(32, 4).toString("base64url") }), {
      get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); },
    });
    try {
      const connection = await storage.addConnection({ ...input, provider: "minio", endpoint: `http://127.0.0.1:${server.port}` });
      await storage.activateConnection(connection.id);
      expect(objects.size).toBe(0);
      const file = await storage.uploadBuffer("screenshots", "wire.png", Buffer.from("wire content"), "image/png");
      expect((await storage.getFile(file.storageBucket, file.objectKey, file.storageConnectionId))?.toString()).toBe("wire content");
      await storage.deleteFile(file.storageBucket, file.objectKey, file.storageConnectionId);
      expect(objects.size).toBe(0);
      expect(signatures.length).toBeGreaterThanOrEqual(6);
      expect(signatures.every(value => value.startsWith("AWS4-HMAC-SHA256"))).toBe(true);
    } finally { await server.stop(true); }
  });

  it("encrypts all credentials and never returns them through settings", async () => {
    const { service, values } = harness();
    const connection = await service.addConnection(input);
    const persisted = values.get(STORAGE_SETTINGS_KEY)!;
    for (const secret of [input.accessKey, input.secretKey, input.sessionToken!]) {
      expect(persisted).not.toContain(secret);
      expect(JSON.stringify(await service.getSettings())).not.toContain(secret);
    }
    expect(connection).not.toHaveProperty("credentials");
    expect((await service.getSettings()).activeConnectionId).toBe(LEGACY_STORAGE_ID);
  });

  it("retains legacy and previous S3 file access after switching and restarting", async () => {
    const h = harness();
    const old = await h.service.uploadBuffer("screenshots", "old.png", Buffer.from("old"), "image/png");
    const first = await h.service.addConnection(input);
    await h.service.activateConnection(first.id);
    expect(h.objects.size).toBe(1); // connection-check objects were deleted
    const s3 = await h.service.uploadBuffer("traces", "run/trace.zip", Buffer.from("trace"), "application/zip");
    expect(s3).toMatchObject({ storageType: "s3", storageConnectionId: first.id, storageBucket: input.bucket, objectKey: "evidence/traces/run/trace.zip" });
    expect(h.options.at(-1)).toMatchObject({ endPoint: "s3.eu-west-1.amazonaws.com", region: "eu-west-1", useSSL: true, pathStyle: false, sessionToken: input.sessionToken });
    const second = await h.service.addConnection({ ...input, bucket: "veriqorn-other" });
    await h.service.activateConnection(second.id);
    const restarted = new ObjectStorageService(h.config, h.store, h.factory);
    await restarted.initialize();
    expect((await restarted.getSettings()).activeConnectionId).toBe(second.id);
    expect((await restarted.getFile(old.storageBucket, old.objectKey, old.storageConnectionId))?.toString()).toBe("old");
    expect((await restarted.getFile(s3.storageBucket, s3.objectKey, s3.storageConnectionId))?.toString()).toBe("trace");
    await restarted.deleteFile(s3.storageBucket, s3.objectKey, s3.storageConnectionId);
    expect(await restarted.getFile(s3.storageBucket, s3.objectKey, s3.storageConnectionId)).toBeNull();
    expect((await restarted.getFile(old.storageBucket, old.objectKey))?.toString()).toBe("old");
    await restarted.activateConnection(LEGACY_STORAGE_ID);
    expect((await restarted.getSettings()).activeConnectionId).toBe(LEGACY_STORAGE_ID);
  });

  it("does not activate a failing or corrupt destination and removes probe objects", async () => {
    const h = harness();
    const connection = await h.service.addConnection(input);
    h.fail(true);
    await expect(h.service.activateConnection(connection.id)).rejects.toMatchObject({ code: "STORAGE_CONNECTION_CHECK_FAILED" });
    expect((await h.service.getSettings()).activeConnectionId).toBe(LEGACY_STORAGE_ID);
    h.fail(false);
    h.corrupt(true);
    await expect(h.service.checkConnection(connection.id)).rejects.toMatchObject({ code: "STORAGE_CONNECTION_CHECK_FAILED" });
    expect(h.objects.size).toBe(0);
  });

  it("captures the connection for uploads that overlap activation", async () => {
    const h = harness();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const uploading = new Promise<void>(resolve => { started = resolve; });
    h.beforeUpload(async key => { if (key === "in-flight.png") { started(); await waiting; } });
    const pending = h.service.uploadBuffer("screenshots", "in-flight.png", Buffer.from("old connection"), "image/png");
    await uploading;
    const connection = await h.service.addConnection(input);
    await h.service.activateConnection(connection.id);
    release();
    const location = await pending;
    expect(location.storageConnectionId).toBeNull();
    expect((await h.service.getFile(location.storageBucket, location.objectKey, location.storageConnectionId))?.toString()).toBe("old connection");
  });

  it("requires a valid encryption key and handles concurrent connection saves", async () => {
    const h = harness(false);
    await expect(h.service.addConnection(input)).rejects.toMatchObject({ code: "STORAGE_ENCRYPTION_KEY_REQUIRED" });
    expect(h.values.size).toBe(0);
    const enabled = harness();
    await Promise.all([enabled.service.addConnection(input), enabled.service.addConnection({ ...input, name: "Backup" })]);
    expect((await enabled.service.getSettings()).connections).toHaveLength(3);
  });

  it("supports managed MinIO connections and rejects endpoint paths or embedded credentials", async () => {
    const h = harness();
    const connection = await h.service.addConnection({ ...input, provider: "minio", endpoint: "http://minio.internal:9000" });
    await h.service.activateConnection(connection.id);
    const file = await h.service.uploadBuffer("artifacts", "log.bin", Buffer.from("log"), "application/octet-stream");
    expect(file.storageType).toBe("minio");
    expect(h.options.at(-1)).toMatchObject({ endPoint: "minio.internal", port: 9000, useSSL: false, pathStyle: true });
    await expect(h.service.addConnection({ ...input, provider: "minio", endpoint: "http://user:password@example.com/" })).rejects.toMatchObject({ code: "STORAGE_ENDPOINT_INVALID" });
    await expect(h.service.addConnection({ ...input, provider: "minio", endpoint: "https://example.com/path" })).rejects.toMatchObject({ code: "STORAGE_ENDPOINT_INVALID" });
  });
});

const authHeaders = { Authorization: "Bearer test-token", Origin: "http://localhost:3000", "Content-Type": "application/json" };
describe("storage administration routes", () => {
  it("downloads attachments from the recorded connection after a switch", async () => {
    const h = harness();
    const first = await h.service.addConnection(input);
    await h.service.activateConnection(first.id);
    const location = await h.service.uploadBuffer("artifacts", "report.bin", Buffer.from("original report"), "application/octet-stream");
    await h.service.activateConnection(LEGACY_STORAGE_ID);
    const app = createTestApp({ services: createProjectScopedServices({
      minio: h.service,
      runs: { getTestRun: async () => ({ id: 42 }) } as unknown as AppServices["runs"],
      testResultsQuery: { findAttachmentForRun: async () => ({ id: "attachment", name: "report.bin", source: "report.bin", type: "application/octet-stream", content: null, ...location }) } as unknown as AppServices["testResultsQuery"],
    }) });
    const response = await app.handle(new Request("http://localhost/api/v1/projects/default/runs/42/attachments/attachment", { headers: authHeaders }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original report");
  });

  it("rejects every storage action for non-admins", async () => {
    const app = createTestApp({ auth: { verify: async () => ({ ...defaultAuthUser, role: "user" }) } });
    for (const [method, path] of [["GET", "/"], ["POST", "/connections"], ["POST", "/connections/id/check"], ["POST", "/connections/id/activate"]]) {
      const response = await app.handle(new Request(`http://localhost/api/v1/system/storage${path}`, { method, headers: authHeaders, ...(method === "POST" ? { body: JSON.stringify(input) } : {}) }));
      expect(response.status).toBe(403);
    }
  });

  it("saves, checks and activates through the admin API without exposing secrets", async () => {
    const h = harness();
    const app = createTestApp({ services: { minio: h.service } });
    const saved = await app.handle(new Request("http://localhost/api/v1/system/storage/connections", { method: "POST", headers: authHeaders, body: JSON.stringify(input) }));
    expect(saved.status).toBe(200);
    const connection = (await saved.json()).data;
    for (const action of ["check", "activate"]) {
      const response = await app.handle(new Request(`http://localhost/api/v1/system/storage/connections/${connection.id}/${action}`, { method: "POST", headers: authHeaders, body: "{}" }));
      expect(response.status).toBe(200);
    }
    const response = await app.handle(new Request("http://localhost/api/v1/system/storage/", { headers: authHeaders }));
    const settings = await response.json();
    expect(settings.data.activeConnectionId).toBe(connection.id);
    expect(JSON.stringify(settings)).not.toContain(input.secretKey);
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const direct = await app.handle(new Request(`http://localhost/api/v1/settings/${STORAGE_SETTINGS_KEY}`, { method, headers: authHeaders, ...(method === "POST" || method === "PUT" ? { body: '{"value":"tampered"}' } : {}) }));
      expect(direct.status).toBe(403);
    }
  });
});
