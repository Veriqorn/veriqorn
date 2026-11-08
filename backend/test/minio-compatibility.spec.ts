import { describe, expect, it } from "bun:test";
import { Client } from "minio";

const createClient = (port: number) => new Client({
  endPoint: "127.0.0.1",
  port,
  useSSL: false,
  region: "us-east-1",
  accessKey: "compatibility-test",
  secretKey: "compatibility-test-secret",
});

describe("MinIO dependency compatibility", () => {
  it("preserves signed query parameters with the ESM query-string package", async () => {
    const client = createClient(9000);
    const disposition = 'inline; filename="report name.html"';
    const url = new URL(await client.presignedGetObject(
      "compatibility", "reports/report name.html", 60,
      { "response-content-disposition": disposition },
    ));
    expect(url.searchParams.get("response-content-disposition")).toBe(disposition);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(decodeURIComponent(url.pathname)).toBe("/compatibility/reports/report name.html");
  });

  it("uploads and downloads objects through the updated SDK dependencies", async () => {
    let uploaded = Buffer.alloc(0);
    const requestedVersions: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        if (request.method === "PUT") {
          uploaded = Buffer.from(await request.arrayBuffer());
          return new Response(null, { headers: { etag: '"compatibility-etag"' } });
        }
        requestedVersions.push(new URL(request.url).searchParams.get("versionId") ?? "");
        return new Response(uploaded, { headers: { "content-type": "text/plain" } });
      },
    });
    try {
      const client = createClient(server.port!);
      await client.putObject("compatibility", "report.txt", Buffer.from("test report"));
      const stream = await client.getObject("compatibility", "report.txt", { versionId: "version / 1" });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe("test report");
      expect(requestedVersions).toEqual(["version / 1"]);
    } finally {
      await server.stop(true);
    }
  });

  it("streams bucket notifications with the updated JSONL parser", async () => {
    const record = { eventName: "s3:ObjectCreated:Put", s3: { object: { key: "report.txt" } } };
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: () => new Response(JSON.stringify({ Records: [record] }) + "\n", {
        headers: { "content-type": "application/x-ndjson" },
      }),
    });
    const poller = createClient(server.port!).listenBucketNotification(
      "compatibility", "", "", ["s3:ObjectCreated:*"],
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const received = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Bucket notification timed out")), 3000);
        poller.on("notification", event => { poller.stop(); resolve(event); });
        poller.on("error", reject);
      });
      expect(received).toEqual(record);
    } finally {
      clearTimeout(timer);
      poller.stop();
      await server.stop(true);
    }
  });
});
