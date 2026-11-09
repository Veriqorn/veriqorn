import { describe, expect, it } from "bun:test";
import { assertSafeOutboundUrl, parsePrivateOutboundOrigins } from "../src/outbound";

describe("explicit private extension destinations", () => {
  const origin = "http://127.0.0.1:1234";
  const target = `${origin}/v1/chat/completions`;

  it("requires a host allowlist even for an explicitly trusted private origin", async () => {
    await expect(assertSafeOutboundUrl(target, [], [origin])).rejects.toThrow("not allowlisted");
  });

  it("denies private destinations by default, including when their host is allowlisted", async () => {
    await expect(assertSafeOutboundUrl(target, ["127.0.0.1"])).rejects.toThrow("private or reserved");
    await expect(assertSafeOutboundUrl("http://[::1]:1234/v1", ["::1"])).rejects.toThrow("private or reserved");
  });

  it("allows a trusted local endpoint only at the configured scheme, host and port", async () => {
    expect((await assertSafeOutboundUrl(target, ["127.0.0.1"], [origin])).toString()).toBe(target);
    await expect(assertSafeOutboundUrl("http://127.0.0.1:1235/v1", ["127.0.0.1"], [origin])).rejects.toThrow("private or reserved");
    await expect(assertSafeOutboundUrl("https://127.0.0.1:1234/v1", ["127.0.0.1"], [origin])).rejects.toThrow("private or reserved");
    await expect(assertSafeOutboundUrl("http://[::1]:1234/v1", ["::1"], [origin])).rejects.toThrow("private or reserved");
  });

  it("still rejects embedded credentials and non-HTTP protocols", async () => {
    await expect(assertSafeOutboundUrl("http://user:password@127.0.0.1:1234/v1", ["127.0.0.1"], [origin])).rejects.toThrow("without embedded credentials");
    await expect(assertSafeOutboundUrl("file:///tmp/model", [], [origin])).rejects.toThrow("HTTP(S)");
  });

  it("validates operator configuration as exact origins", () => {
    expect(parsePrivateOutboundOrigins()).toEqual([]);
    expect(parsePrivateOutboundOrigins(" http://HOST.docker.internal:1234/,https://localhost:8443 ")).toEqual(["http://host.docker.internal:1234", "https://localhost:8443"]);
    for (const value of ["*", "http://*.internal:1234", "http://localhost:1234/v1", "http://localhost:1234/?token=x", "http://user:secret@localhost:1234", "file:///tmp/model"]) {
      expect(() => parsePrivateOutboundOrigins(value)).toThrow("OUTBOUND_PRIVATE_ALLOWED_ORIGINS");
    }
  });
});
