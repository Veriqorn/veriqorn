import { createHash, createPublicKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { AiEditionNativeService } from "../src/services";

class SettingsStub {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

describe("installation-bound AI licenses", () => {
  test("does not activate a copied license at a different installation", async () => {
    const issuer = generateKeyPairSync("ed25519");
    const previousPublicKey = process.env.AI_ANALYSIS_LICENSE_PUBLIC_KEY;
    process.env.AI_ANALYSIS_LICENSE_PUBLIC_KEY = issuer.publicKey.export({ format: "pem", type: "spki" }).toString();
    try {
      const source = new AiEditionNativeService(new SettingsStub() as never);
      const request = await source.getLicenseActivationRequest();
      const fingerprint = createHash("sha256")
        .update(createPublicKey(request.installationPublicKey).export({ format: "der", type: "spki" }))
        .digest("base64url");
      expect(request.installationKeyFingerprint).toBe(fingerprint);
      const payload = {
        version: 2,
        licenseId: "lic_test",
        customerId: "scentbird",
        customer: "Scentbird",
        issuedAt: "2026-08-09T00:00:00.000Z",
        expiresAt: "2030-12-31T23:59:59.999Z",
        features: ["analysis"],
        installationId: request.installationId,
        installationKeyFingerprint: request.installationKeyFingerprint,
      };
      const license = {
        payload,
        signature: cryptoSign(null, Buffer.from(JSON.stringify(payload), "utf8"), issuer.privateKey).toString("base64"),
      };
      expect((await source.activateLicense(license)).success).toBe(true);

      const otherInstallation = new AiEditionNativeService(new SettingsStub() as never);
      const copied = await otherInstallation.activateLicense(license);
      expect(copied.success).toBe(false);
      expect(copied.message).toContain("different installation");
    } finally {
      if (previousPublicKey === undefined) delete process.env.AI_ANALYSIS_LICENSE_PUBLIC_KEY;
      else process.env.AI_ANALYSIS_LICENSE_PUBLIC_KEY = previousPublicKey;
    }
  });
});
