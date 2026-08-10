import { createPublicKey, type KeyObject, verify as cryptoVerify } from 'crypto'
import { readFileSync } from 'fs'
import { resolve as resolvePath } from 'path'

import { HttpError } from './errors'
import { InstallationIdentityService } from './installation-identity'

type SettingsPort = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
const AI_MODE_KEY = "aiAnalysisMode";
const AI_LICENSE_KEY = "aiAnalysisLicense";
const AI_UPGRADE_URL_KEY = "aiAnalysisUpgradeUrl";

type AiEditionMode = "oss_stub" | "pro_self_hosted";
type AiLicenseStatus = "stub" | "licensed" | "invalid" | "expired";

interface AiLicensePayload {
  version: 2;
  licenseId: string;
  customerId: string;
  customer: string;
  issuedAt: string;
  expiresAt: string | null;
  features: string[];
  installationId: string;
  installationKeyFingerprint: string;
}

export interface AiLicenseActivationRequest {
  version: 1;
  product: "veriqorn-platform";
  installationId: string;
  installationPublicKey: string;
  installationKeyFingerprint: string;
  createdAt: string;
}

interface AiFeatureAvailability {
  enabled: boolean;
  reason?: string;
}

interface AiCapabilitiesFeatures {
  analysis: AiFeatureAvailability;
  indexing: AiFeatureAvailability;
  retrieval: AiFeatureAvailability;
  kibanaConnector: AiFeatureAvailability;
  sentryConnector: AiFeatureAvailability;
  grafanaConnector: AiFeatureAvailability;
}

export interface AiCapabilitiesResponse {
  mode: AiEditionMode;
  status: AiLicenseStatus;
  licensed: boolean;
  upgradeUrl: string | null;
  message: string;
  features: AiCapabilitiesFeatures;
  license: Pick<AiLicensePayload, "licenseId" | "customer" | "issuedAt" | "expiresAt"> | null;
}

const disabledFeatures = (reason: string): AiCapabilitiesFeatures => ({
  analysis: { enabled: false, reason },
  indexing: { enabled: false, reason },
  retrieval: { enabled: false, reason },
  kibanaConnector: { enabled: false, reason },
  sentryConnector: { enabled: false, reason },
  grafanaConnector: { enabled: false, reason },
});

const normalizeFeatureTokens = (features: unknown): Set<string> => {
  if (!Array.isArray(features)) return new Set();
  return new Set(
    features
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
};

export class AiEditionNativeService {
  private cachedPublicKey: KeyObject | null | undefined;

  constructor(
    private readonly settings: SettingsPort,
    private readonly installationIdentity = new InstallationIdentityService(settings),
  ) {}

  async getCapabilities(): Promise<AiCapabilitiesResponse> {
    const mode = await this.resolveMode();
    const upgradeUrl = await this.resolveUpgradeUrl();

    if (mode === "oss_stub") {
      const message =
        "AI Analysis Pro is required. Configure a valid AI Pro license to unlock indexing, retrieval, and connectors.";
      return {
        mode,
        status: "stub",
        licensed: false,
        upgradeUrl,
        message,
        features: disabledFeatures(message),
        license: null,
      };
    }

    const evaluation = await this.evaluateLicense();
    if (evaluation.status !== "licensed" || !evaluation.payload) {
      return {
        mode,
        status: evaluation.status,
        licensed: false,
        upgradeUrl,
        message: evaluation.message,
        features: disabledFeatures(evaluation.message),
        license: null,
      };
    }

    return {
      mode,
      status: "licensed",
      licensed: true,
      upgradeUrl,
      message: "AI Analysis Pro license is active.",
      features: this.resolveLicensedFeatures(evaluation.payload.features),
      license: {
        licenseId: evaluation.payload.licenseId,
        customer: evaluation.payload.customer,
        issuedAt: evaluation.payload.issuedAt,
        expiresAt: evaluation.payload.expiresAt,
      },
    };
  }

  async activateLicense(licenseInput: unknown): Promise<{ success: boolean; message: string; licenseId?: string }> {
    const licenseJson = this.extractLicenseJson(licenseInput);
    if (!licenseJson) return { success: false, message: "License payload is empty." };

    let parsed: unknown;
    try {
      parsed = JSON.parse(licenseJson);
    } catch {
      return { success: false, message: "Invalid JSON format." };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { success: false, message: "License must be a JSON object." };
    }

    const record = parsed as Record<string, unknown>;
    const hasPayload = record.payload && typeof record.payload === "object";
    const hasSignature = typeof record.signature === "string" && (record.signature as string).length > 0;
    if (!hasPayload || !hasSignature) {
      return {
        success: false,
        message: "License must contain a 'payload' object and a 'signature' string.",
      };
    }

    this.cachedPublicKey = undefined;
    const evaluation = await this.evaluateLicenseJson(licenseJson);
    const payload = record.payload as Record<string, unknown>;
    const licenseId = typeof payload.licenseId === "string" ? payload.licenseId : undefined;
    if (evaluation.status === "licensed") {
      await this.settings.set(AI_LICENSE_KEY, licenseJson.trim());
      await this.settings.set(AI_MODE_KEY, "pro_self_hosted");
      return { success: true, message: "License activated successfully.", licenseId };
    }
    return { success: false, message: evaluation.message || "License validation failed.", licenseId };
  }

  async getLicenseActivationRequest(): Promise<AiLicenseActivationRequest> {
    const identity = await this.installationIdentity.get();
    return {
      version: 1,
      product: "veriqorn-platform",
      installationId: identity.installationId,
      installationPublicKey: identity.publicKeyPem,
      installationKeyFingerprint: identity.fingerprint,
      createdAt: identity.createdAt,
    };
  }

  async assertFeatureEnabled(feature: keyof AiCapabilitiesFeatures): Promise<void> {
    const caps = await this.getCapabilities();
    const availability = caps.features[feature];
    if (availability.enabled) return;
    throw new HttpError(403, "AI_PRO_REQUIRED", availability.reason || caps.message);
  }

  private extractLicenseJson(input: unknown): string | null {
    if (!input) return null;
    if (typeof input === "string") return input.trim() || null;
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      if (typeof record.license === "string") return record.license.trim() || null;
      if (record.payload && record.signature) return JSON.stringify(input);
    }
    return null;
  }

  private async resolveMode(): Promise<AiEditionMode> {
    const raw = (await this.settings.get(AI_MODE_KEY))?.trim()
      || String(process.env.AI_ANALYSIS_DEFAULT_MODE || "oss_stub").trim();
    return raw === "pro_self_hosted" ? "pro_self_hosted" : "oss_stub";
  }

  private async resolveUpgradeUrl(): Promise<string | null> {
    const configured = (await this.settings.get(AI_UPGRADE_URL_KEY))?.trim();
    if (configured) return configured;
    const env = (process.env.AI_ANALYSIS_UPGRADE_URL || "").trim();
    return env || null;
  }

  private async evaluateLicense(): Promise<{ status: AiLicenseStatus; message: string; payload: AiLicensePayload | null }> {
    const rawLicense = (await this.settings.get(AI_LICENSE_KEY))?.trim();
    if (!rawLicense) {
      return {
        status: "invalid",
        message: "AI Pro license is not configured.",
        payload: null,
      };
    }

    return this.evaluateLicenseJson(rawLicense);
  }

  private async evaluateLicenseJson(rawLicense: string): Promise<{ status: AiLicenseStatus; message: string; payload: AiLicensePayload | null }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLicense);
    } catch {
      return { status: "invalid", message: "AI Pro license payload is malformed.", payload: null };
    }

    const signed = this.normalizeSignedLicense(parsed);
    if (!signed) return { status: "invalid", message: "AI Pro license format is invalid.", payload: null };

    const publicKey = this.getLicensePublicKey();
    if (!publicKey) {
      return {
        status: "invalid",
        message: "AI Pro verification key is not available. Place ai-license-public.pem in the project root or set AI_ANALYSIS_LICENSE_PUBLIC_KEY / AI_ANALYSIS_LICENSE_PUBLIC_KEY_PATH.",
        payload: null,
      };
    }

    const signatureBuffer = this.decodeBase64Signature(signed.signature);
    if (!signatureBuffer) {
      return { status: "invalid", message: "AI Pro license signature is not valid base64.", payload: null };
    }

    const payloadBuffer = Buffer.from(JSON.stringify(signed.payload), "utf8");
    const verified = cryptoVerify(null, payloadBuffer, publicKey, signatureBuffer);
    if (!verified) {
      return { status: "invalid", message: "AI Pro license signature verification failed.", payload: null };
    }

    if (signed.payload.expiresAt) {
      const expiresAt = Date.parse(signed.payload.expiresAt);
      if (Number.isNaN(expiresAt)) {
        return { status: "invalid", message: "AI Pro license has an invalid expiresAt timestamp.", payload: null };
      }
      if (expiresAt < Date.now()) {
        return {
          status: "expired",
          message: `AI Pro license expired at ${signed.payload.expiresAt}.`,
          payload: null,
        };
      }
    }

    let installation: {
      installationId: string;
      publicKeyPem: string;
      fingerprint: string;
      createdAt: string;
    };
    try {
      installation = await this.installationIdentity.get();
    } catch {
      return { status: "invalid", message: "AI Pro installation identity is not available.", payload: null };
    }
    if (signed.payload.installationId !== installation.installationId
      || signed.payload.installationKeyFingerprint !== installation.fingerprint) {
      return {
        status: "invalid",
        message: "AI Pro license is issued for a different installation.",
        payload: null,
      };
    }

    return { status: "licensed", message: "AI Analysis Pro license is active.", payload: signed.payload };
  }

  private normalizeSignedLicense(value: unknown): { payload: AiLicensePayload; signature: string } | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const signature = typeof record.signature === "string" ? record.signature.trim() : "";
    if (!signature) return null;
    const payload = this.normalizeLicensePayload(record.payload);
    if (!payload) return null;
    return { payload, signature };
  }

  private normalizeLicensePayload(value: unknown): AiLicensePayload | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 2) return null;
    const licenseId = typeof record.licenseId === "string" ? record.licenseId.trim() : "";
    const customerId = typeof record.customerId === "string" ? record.customerId.trim() : "";
    const customer = typeof record.customer === "string" ? record.customer.trim() : "";
    const issuedAt = typeof record.issuedAt === "string" ? record.issuedAt.trim() : "";
    const installationId = typeof record.installationId === "string" ? record.installationId.trim() : "";
    const installationKeyFingerprint = typeof record.installationKeyFingerprint === "string" ? record.installationKeyFingerprint.trim() : "";
    if (!licenseId || !customerId || !customer || !issuedAt || !installationId || !installationKeyFingerprint) return null;
    if (Number.isNaN(Date.parse(issuedAt))) return null;
    const expiresAt = typeof record.expiresAt === "string" && record.expiresAt.trim() ? record.expiresAt.trim() : null;
    return {
      version: 2,
      licenseId,
      customerId,
      customer,
      issuedAt,
      expiresAt,
      features: Array.from(normalizeFeatureTokens(record.features)),
      installationId,
      installationKeyFingerprint,
    };
  }

  private resolveLicensedFeatures(features: string[]): AiCapabilitiesFeatures {
    const tokens = normalizeFeatureTokens(features);
    const all = tokens.has("*") || tokens.has("all") || tokens.has("feature:all");
    const allConnectors = all || tokens.has("connector:all") || tokens.has("connectors:all");
    const has = (candidates: string[], connectorGroup = false) =>
      all || (connectorGroup && allConnectors) || candidates.some((t) => tokens.has(t));
    const to = (enabled: boolean): AiFeatureAvailability =>
      enabled ? { enabled: true } : { enabled: false, reason: "Feature is not included in the current AI Pro license." };
    return {
      analysis: to(has(["analysis"])),
      indexing: to(has(["indexing"])),
      retrieval: to(has(["retrieval"])),
      kibanaConnector: to(has(["connector:kibana", "kibana"], true)),
      sentryConnector: to(has(["connector:sentry", "sentry"], true)),
      grafanaConnector: to(has(["connector:grafana", "grafana"], true)),
    };
  }

  private decodeBase64Signature(signature: string): Buffer | null {
    const normalized = signature.trim().replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4;
    const padded = pad === 0 ? normalized : normalized + "=".repeat(4 - pad);
    try {
      const decoded = Buffer.from(padded, "base64");
      return decoded.length > 0 ? decoded : null;
    } catch { return null; }
  }

  private getLicensePublicKey(): KeyObject | null {
    if (this.cachedPublicKey !== undefined) return this.cachedPublicKey;
    const rawKey = this.loadPublicKeyMaterial();
    if (!rawKey) { this.cachedPublicKey = null; return null; }
    try {
      this.cachedPublicKey = rawKey.includes("BEGIN PUBLIC KEY")
        ? createPublicKey(rawKey)
        : createPublicKey({ key: Buffer.from(rawKey, "base64"), format: "der", type: "spki" });
      return this.cachedPublicKey;
    } catch {
      this.cachedPublicKey = null;
      return null;
    }
  }

  private loadPublicKeyMaterial(): string {
    const envKey = String(process.env.AI_ANALYSIS_LICENSE_PUBLIC_KEY || "").trim();
    if (envKey) return envKey;

    const explicitPath = String(process.env.AI_ANALYSIS_LICENSE_PUBLIC_KEY_PATH || "").trim();
    const candidates = [
      explicitPath,
      resolvePath(process.cwd(), "ai-license-public.pem"),
      resolvePath(process.cwd(), "..", "ai-license-public.pem"),
      resolvePath(process.cwd(), "..", "..", "ai-license-public.pem"),
      resolvePath(process.cwd(), "backend", "..", "ai-license-public.pem"),
      "/app/ai-license-public.pem",
    ].filter((candidate) => candidate.length > 0);

    for (const candidate of candidates) {
      try {
        const content = readFileSync(candidate, "utf8").trim();
        if (content) return content;
      } catch { /* try next candidate */ }
    }
    return "";
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ LLM adapter (chat + test connection) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AI Failure Analysis (minimal LLM-only port) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
