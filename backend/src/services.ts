import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";

import { compare, getRounds as bcryptGetRounds, hash as bcryptHash } from "bcrypt";
import { SignJWT, jwtVerify } from "jose";
import { Client } from "minio";
import { DataSource, Repository } from "typeorm";
import type { LlmChatMessage, LlmServicePort } from "@veriqorn/contracts";

import { User } from "./entities/user.entity";
import { ApiKey } from "./entities/api-key.entity";
import { Project } from "./entities/project.entity";
import { ProjectMembership, type ProjectRole } from "./entities/project-membership.entity";
import { TestRun, type TestRunStats } from "./entities/test-run.entity";
import { TestResult } from "./entities/test-result.entity";
import { TestStep } from "./entities/test-step.entity";
import { TestAttachment } from "./entities/test-attachment.entity";
import { Settings } from "./entities/settings.entity";
import { NotificationDelivery } from "./entities/notification-delivery.entity";
import { ChatConversation } from "./entities/chat-conversation.entity";
import { ChatMessage } from "./entities/chat-message.entity";
import { ProjectsService as LegacyProjectsService } from "./domain/projects";
import { ProjectAccessService as LegacyProjectAccessService } from "./domain/project-access";
import { TestResultsQueryService as LegacyTestResultsQueryService } from "./domain/test-results-query";
import { AllureImportService as LegacyAllureImportService } from "./domain/allure-import";
import { UploadOrchestrationService as LegacyUploadOrchestrationService } from "./domain/upload-orchestration";
import { RerunsService } from "./domain/reruns";
import type { IndexingPort } from "./indexing-port";
import { assertSafeOutboundUrl } from "./outbound";
import { McpService } from "./domain/mcp";
import { TestRerunJob } from "./entities/test-rerun-job.entity";
import { TestRerunJobItem } from "./entities/test-rerun-job-item.entity";
import type { AppConfig } from "./config";
import { EntitlementService } from "./entitlements";
import { InstallationIdentityService } from "./installation-identity";
import { AiEditionNativeService, type AiCapabilitiesResponse } from "./legacy-v2-entitlements";
export { AiEditionNativeService, type AiCapabilitiesResponse } from "./legacy-v2-entitlements";
import { ExtensionServiceRegistry } from "./extension-service-registry";
import { HttpError } from "./errors";
import type { AuthUser } from "./http";

type DashboardVisualizationType = "stat" | "line" | "bar" | "area" | "pie" | "table";
type DashboardDataSourceType =
  | "test-summary"
  | "test-trend"
  | "recent-runs"
  | "pass-rate"
  | "latest-run-status"
  | "pass-fail-trend"
  | "flaky-rate"
  | "top-failing-tests"
  | "top-failing-suites";

type DashboardWidgetLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};
type DashboardWidget = {
  id: string;
  title: string;
  visualization: DashboardVisualizationType;
  dataSource: DashboardDataSourceType | string;
  layout?: DashboardWidgetLayout;
  options?: Record<string, unknown>;
};

type DashboardConfig = {
  id: string;
  name: string;
  isDefault: boolean;
  order: number;
  widgets: DashboardWidget[];
  updatedAt: string;
};

type DashboardState = {
  dashboards: DashboardConfig[];
};

type DashboardMetricsFilters = {
  dateFrom?: string;
  dateTo?: string;
  branch?: string;
  environment?: string;
  tags?: string[];
  status?: string;
};

type DashboardPassFailTrendPoint = {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
  broken: number;
  total: number;
};

type DashboardTopFailingTest = {
  name: string;
  failures: number;
  flakyRuns: number;
  lastStatus: string;
  lastRunAt?: string;
};

type DashboardTopFailingSuite = {
  name: string;
  failures: number;
  tests: number;
};

type DashboardMetricsSummary = {
  totalRuns: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  broken: number;
  passRate: number;
};

type DashboardMetricsResponse = {
  filters: DashboardMetricsFilters;
  summary: DashboardMetricsSummary;
  passFailTrend: DashboardPassFailTrendPoint[];
  flakyRate: {
    percentage: number;
    flakyTests: number;
    trackedTests: number;
  };
  topFailingTests: DashboardTopFailingTest[];
  topFailingSuites: DashboardTopFailingSuite[];
  cache: {
    key: string;
    hit: boolean;
    generatedAt: string;
    expiresAt: string;
    ttlSeconds: number;
  };
};

type CreateDashboardInput = {
  name?: string;
  isDefault?: boolean;
  order?: number;
  widgets?: DashboardWidget[];
};

type UpdateDashboardInput = CreateDashboardInput;

const encoder = new TextEncoder();

export const DEFAULT_PROJECT_ID = "default";

class SettingsStore {
  constructor(private readonly settingsRepository: Repository<Settings>) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.settingsRepository.findOne({ where: { key } });
    return setting?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const existing = await this.settingsRepository.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      existing.updatedAt = new Date();
      await this.settingsRepository.save(existing);
      return;
    }

    await this.settingsRepository.save(this.settingsRepository.create({ key, value }));
  }
}

/**
 * Core-owned compatibility bridge. It contains no provider code and resolves
 * the Enterprise contribution only after the extension has been initialized.
 */
class ExtensionLlmProxy implements LlmServicePort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}

  private provider(): LlmServicePort {
    const provider = this.extensions.get<LlmServicePort>("enterprise-ai", "llm");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider;
  }

  loadConfig() { return this.provider().loadConfig(); }
  chat(...args: Parameters<LlmServicePort["chat"]>) { return this.provider().chat(...args); }
  chatStream(...args: Parameters<LlmServicePort["chatStream"]>) { return this.provider().chatStream(...args); }
  testConnection(...args: Parameters<LlmServicePort["testConnection"]>) { return this.provider().testConnection(...args); }
}

type AiFailureAnalysisPort = {
  analyzeFailure(request: AiFailureAnalysisRequest): Promise<unknown>;
}

class ExtensionAiFailureAnalysisProxy implements AiFailureAnalysisPort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}

  async analyzeFailure(request: AiFailureAnalysisRequest): Promise<unknown> {
    const provider = this.extensions.get<AiFailureAnalysisPort>("enterprise-ai", "aiFailureAnalysis");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider.analyzeFailure(request);
  }
}

type AiResultsPort = {
  getByResultId(resultId: string): Promise<unknown>;
  getResultContext(resultId: string): Promise<{ projectId: string; testRunId: number } | null>;
}

type AiChatPort = {
  getMessages(testResultId: string): Promise<unknown>;
  sendMessage(testResultId: string, testRunId: number, content: string, authorName?: string): Promise<unknown>;
  getMessageTestResultId(messageId: number): Promise<string | null>;
  deleteMessage(messageId: number): Promise<void>;
}

type KbPort = {
  listArticles(projectId: string, category?: string): Promise<unknown>;
  getArticle(projectId: string, slug: string): Promise<unknown>;
  listCategories(projectId: string): Promise<unknown>;
  getStatus(projectId: string): Promise<unknown>;
  enqueueGenerationJob(projectId: string): Promise<unknown>;
};

type CoveragePort = {
  getInventory(projectId: string): Promise<unknown>;
  rebuildInventory(projectId: string): Promise<unknown>;
  computeSummary(projectId: string): Promise<unknown>;
  computeModuleBreakdown(projectId: string): Promise<unknown>;
  computeBreakdown(projectId: string): Promise<unknown>;
  computeGaps(projectId: string): Promise<unknown>;
  getRecommendations(projectId: string): Promise<unknown>;
  generateRecommendations(projectId: string): Promise<unknown>;
};

class ExtensionCoverageProxy implements CoveragePort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}
  private provider(): CoveragePort {
    const provider = this.extensions.get<CoveragePort>("enterprise-ai", "coverage");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider;
  }
  getInventory(...args: Parameters<CoveragePort["getInventory"]>) { return this.provider().getInventory(...args); }
  rebuildInventory(...args: Parameters<CoveragePort["rebuildInventory"]>) { return this.provider().rebuildInventory(...args); }
  computeSummary(...args: Parameters<CoveragePort["computeSummary"]>) { return this.provider().computeSummary(...args); }
  computeModuleBreakdown(...args: Parameters<CoveragePort["computeModuleBreakdown"]>) { return this.provider().computeModuleBreakdown(...args); }
  computeBreakdown(...args: Parameters<CoveragePort["computeBreakdown"]>) { return this.provider().computeBreakdown(...args); }
  computeGaps(...args: Parameters<CoveragePort["computeGaps"]>) { return this.provider().computeGaps(...args); }
  getRecommendations(...args: Parameters<CoveragePort["getRecommendations"]>) { return this.provider().getRecommendations(...args); }
  generateRecommendations(...args: Parameters<CoveragePort["generateRecommendations"]>) { return this.provider().generateRecommendations(...args); }
}

class ExtensionKbProxy implements KbPort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}
  private provider(): KbPort {
    const provider = this.extensions.get<KbPort>("enterprise-ai", "kb");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider;
  }
  listArticles(...args: Parameters<KbPort["listArticles"]>) { return this.provider().listArticles(...args); }
  getArticle(...args: Parameters<KbPort["getArticle"]>) { return this.provider().getArticle(...args); }
  listCategories(...args: Parameters<KbPort["listCategories"]>) { return this.provider().listCategories(...args); }
  getStatus(...args: Parameters<KbPort["getStatus"]>) { return this.provider().getStatus(...args); }
  enqueueGenerationJob(...args: Parameters<KbPort["enqueueGenerationJob"]>) { return this.provider().enqueueGenerationJob(...args); }
}

class ExtensionIndexingProxy implements IndexingPort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}
  private provider(): IndexingPort {
    const provider = this.extensions.get<IndexingPort>("enterprise-ai", "indexing");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider;
  }
  configureAutoIndex(...args: Parameters<IndexingPort["configureAutoIndex"]>) { return this.provider().configureAutoIndex(...args); }
  syncAutoIndexWatchers(...args: Parameters<IndexingPort["syncAutoIndexWatchers"]>) { return this.provider().syncAutoIndexWatchers(...args); }
  runAutoIndexTick(...args: Parameters<IndexingPort["runAutoIndexTick"]>) { return this.provider().runAutoIndexTick(...args); }
  getAutoIndexRuntimeStatus(...args: Parameters<IndexingPort["getAutoIndexRuntimeStatus"]>) { return this.provider().getAutoIndexRuntimeStatus(...args); }
  listIndexJobs(...args: Parameters<IndexingPort["listIndexJobs"]>) { return this.provider().listIndexJobs(...args); }
  createIndexJob(...args: Parameters<IndexingPort["createIndexJob"]>) { return this.provider().createIndexJob(...args); }
  indexRepositories(...args: Parameters<IndexingPort["indexRepositories"]>) { return this.provider().indexRepositories(...args); }
  getCatalogSummary(...args: Parameters<IndexingPort["getCatalogSummary"]>) { return this.provider().getCatalogSummary(...args); }
  getLatestCatalog(...args: Parameters<IndexingPort["getLatestCatalog"]>) { return this.provider().getLatestCatalog(...args); }
  retrieveEvidence(...args: Parameters<IndexingPort["retrieveEvidence"]>) { return this.provider().retrieveEvidence(...args); }
  getRetrievalDiagnostics(...args: Parameters<IndexingPort["getRetrievalDiagnostics"]>) { return this.provider().getRetrievalDiagnostics(...args); }
  runRetrievalBenchmark(...args: Parameters<IndexingPort["runRetrievalBenchmark"]>) { return this.provider().runRetrievalBenchmark(...args); }
  testConnector(...args: Parameters<IndexingPort["testConnector"]>) { return this.provider().testConnector(...args); }
  resolveLocalRepositoryPath(...args: Parameters<IndexingPort["resolveLocalRepositoryPath"]>) { return this.provider().resolveLocalRepositoryPath(...args); }
}

class ExtensionAiResultsProxy implements AiResultsPort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}
  private provider(): AiResultsPort {
    const provider = this.extensions.get<AiResultsPort>("enterprise-ai", "aiResults");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider;
  }
  getByResultId(resultId: string) { return this.provider().getByResultId(resultId); }
  getResultContext(resultId: string) { return this.provider().getResultContext(resultId); }
}

class ExtensionAiChatProxy implements AiChatPort {
  constructor(private readonly extensions: ExtensionServiceRegistry) {}
  private provider(): AiChatPort {
    const provider = this.extensions.get<AiChatPort>("enterprise-ai", "aiChat");
    if (!provider) throw new HttpError(404, "ENTERPRISE_EXTENSION_UNAVAILABLE", "This Enterprise capability is not installed.");
    return provider;
  }
  getMessages(testResultId: string) { return this.provider().getMessages(testResultId); }
  sendMessage(testResultId: string, testRunId: number, content: string, authorName?: string) { return this.provider().sendMessage(testResultId, testRunId, content, authorName); }
  getMessageTestResultId(messageId: number) { return this.provider().getMessageTestResultId(messageId); }
  deleteMessage(messageId: number) { return this.provider().deleteMessage(messageId); }
}

export class MinioStorageService {
  private client: Client | null = null;
  private enabled: boolean;

  constructor(private readonly config: AppConfig) {
    this.enabled = config.minioEnabled;

    if (this.enabled) {
      try {
        this.client = new Client({
          endPoint: config.minioEndpoint,
          port: config.minioPort,
          useSSL: config.minioUseSsl,
          accessKey: config.minioAccessKey,
          secretKey: config.minioSecretKey,
        });
      } catch {
        this.enabled = false;
      }
    }
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    for (const bucket of ["artifacts", "traces", "screenshots"]) {
      const exists = await this.client!.bucketExists(bucket);
      if (!exists) {
        await this.client!.makeBucket(bucket);
      }
    }
  }

  isAvailable(): boolean {
    return this.enabled && this.client !== null;
  }

  async uploadBuffer(bucketName: string, objectName: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    await this.client!.putObject(bucketName, objectName, buffer, buffer.length, {
      "Content-Type": contentType,
    });
  }

  async getFile(bucketName: string, objectName: string): Promise<Buffer | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const stream = await this.client!.getObject(bucketName, objectName);
      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    } catch {
      return null;
    }
  }

  async deleteFile(bucketName: string, objectName: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    await this.client!.removeObject(bucketName, objectName);
  }
}

export type PlatformUpdateStatus = {
  configured: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotesUrl: string | null;
  job: {
    id: string;
    status: "idle" | "queued" | "running" | "succeeded" | "failed";
    message?: string;
    requestedAt?: string;
  } | null;
};

/**
 * Deliberately only talks to a separately deployed update agent.  The platform
 * process never gets a Docker socket, compose file, or registry credentials.
 */
export class PlatformUpdateService {
  constructor(private readonly config: AppConfig) {}

  private get isConfigured(): boolean {
    return Boolean(this.config.updateAgentUrl && this.config.updateAgentToken);
  }

  private headers(body?: string): Headers {
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (this.config.updateAgentToken) headers.set("Authorization", `Bearer ${this.config.updateAgentToken}`);
    return headers;
  }

  private async agent<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config.updateAgentUrl || !this.config.updateAgentToken) {
      throw new HttpError(503, "UPDATE_AGENT_NOT_CONFIGURED", "In-app updates have not been configured by this installation.");
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.updateAgentUrl}${path}`, {
        ...init,
        headers: this.headers(typeof init.body === "string" ? init.body : undefined),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpError(503, "UPDATE_AGENT_UNAVAILABLE", "The update agent is unavailable.");
    }

    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new HttpError(502, "UPDATE_AGENT_ERROR", "The update agent returned an invalid response.");
    }
    return payload as T;
  }

  async getStatus(): Promise<PlatformUpdateStatus> {
    if (!this.isConfigured) {
      return { configured: false, currentVersion: this.config.platformVersion, latestVersion: null, updateAvailable: false, releaseNotesUrl: null, job: null };
    }
    const value = await this.agent<Omit<PlatformUpdateStatus, "configured" | "currentVersion"> & { currentVersion?: string }>("/v1/updates/status");
    return {
      configured: true,
      currentVersion: typeof value.currentVersion === "string" ? value.currentVersion : this.config.platformVersion,
      latestVersion: typeof value.latestVersion === "string" ? value.latestVersion : null,
      updateAvailable: value.updateAvailable === true,
      releaseNotesUrl: this.safeExternalHttpUrl(value.releaseNotesUrl),
      job: value.job && typeof value.job === "object" ? value.job : null,
    };
  }

  private safeExternalHttpUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  async requestUpdate(actor: Pick<AuthUser, "email" | "sub">) {
    return this.agent<{ id: string; status: "queued" | "running"; message?: string }>("/v1/updates/jobs", {
      body: JSON.stringify({ requestedAt: new Date().toISOString(), requestedBy: { email: actor.email, id: actor.sub } }),
      method: "POST",
    });
  }
}

class AuthService {
  private readonly secret: Uint8Array;
  private static readonly dummyPasswordHash = "$2b$12$9y3hDjrO6syhHc9ErDtQheLz652YFiUWcdPL5VJYnpFXQq3lNpm1q";

  constructor(
    private readonly userRepository: Repository<User>,
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly config: AppConfig,
  ) {
    this.secret = encoder.encode(config.jwtSecret);
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; accessToken: string }> {
    const user = await this.userRepository.findOne({ where: { email } });
    const valid = await compare(password, user?.password || AuthService.dummyPasswordHash);
    if (!user || !user.password || !valid) {
      throw new HttpError(401, "AUTH_INVALID", "Invalid email or password");
    }
    if (bcryptGetRounds(user.password) < 12) {
      user.password = await bcryptHash(password, 12);
      await this.userRepository.save(user);
    }

    const authUser: AuthUser = {
      sub: user.id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const accessToken = await new SignJWT({ ...authUser, sv: user.sessionVersion ?? 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(authUser.sub)
      .setIssuer(this.config.jwtIssuer)
      .setAudience(this.config.jwtAudience)
      .setIssuedAt()
      .setExpirationTime("1d")
      .sign(this.secret);

    return { user: authUser, accessToken };
  }

  async verify(token: string): Promise<AuthUser> {
    if (token.startsWith("qarp_")) {
      return this.verifyApiKey(token);
    }
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],

        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
      const userId = Number.parseInt(String(payload.sub || ""), 10);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new HttpError(401, "AUTH_INVALID", "Authentication failed");
      }

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user || Number(payload.sv ?? 0) !== (user.sessionVersion ?? 0)) {
        throw new HttpError(401, "AUTH_INVALID", "User not found");
      }

      return {
        sub: user.id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      };
    } catch {
      throw new HttpError(401, "AUTH_INVALID", "Authentication failed");
    }
  }

  private async verifyApiKey(token: string): Promise<AuthUser> {
    const keyHash = createHash("sha256").update(token).digest("hex");
    const apiKey = await this.apiKeyRepository.findOne({ where: { keyHash } });
    if (!apiKey || (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now())) {
      throw new HttpError(401, "AUTH_INVALID", "Authentication failed");
    }
    const user = await this.userRepository.findOne({ where: { id: apiKey.userId } });
    if (!user) throw new HttpError(401, "AUTH_INVALID", "Authentication failed");
    apiKey.lastUsedAt = new Date();
    await this.apiKeyRepository.save(apiKey);
    return { sub: user.id.toString(), email: user.email, name: user.name, role: user.role };
  }

  async revoke(user: AuthUser): Promise<void> {
    const id = Number.parseInt(user.sub, 10);
    if (!Number.isInteger(id) || id <= 0) return;
    await this.userRepository.increment({ id }, "sessionVersion", 1);
  }
}

class ProfileService {
  constructor(
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly userRepository: Repository<User>,
  ) {}

  async updateProfile(user: AuthUser, body: { name: string }) {
    const entity = await this.userRepository.findOne({ where: { id: Number.parseInt(user.sub, 10) } });
    if (!entity) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "User not found");
    }

    entity.name = body.name.trim();
    const saved = await this.userRepository.save(entity);
    return {
      email: saved.email,
      id: saved.id.toString(),
      name: saved.name,
      role: saved.role,
    };
  }

  async changePassword(user: AuthUser, body: { currentPassword: string; newPassword: string }) {
    const entity = await this.userRepository.findOne({ where: { id: Number.parseInt(user.sub, 10) } });
    if (!entity) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "User not found");
    }

    const isCurrentPasswordValid = await compare(body.currentPassword, entity.password);
    if (!isCurrentPasswordValid) {
      throw new HttpError(400, "PROFILE_PASSWORD_INVALID", "Current password is incorrect");
    }

    entity.password = await bcryptHash(body.newPassword, 12);
    entity.sessionVersion = (entity.sessionVersion ?? 0) + 1;
    await this.userRepository.save(entity);
    return { success: true };
  }

  async createApiKey(user: AuthUser, body: { name?: string; expiresAt?: string }) {
    const rawKey = `qarp_${randomBytes(32).toString("hex")}`;
    const apiKey = this.apiKeyRepository.create({
      userId: Number.parseInt(user.sub, 10),
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      keyPrefix: rawKey.slice(0, 12),
      name: body.name?.trim() || "Unnamed Key",
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
    const saved = await this.apiKeyRepository.save(apiKey);

    return {
      id: saved.id,
      key: rawKey,
      keyPrefix: saved.keyPrefix,
      name: saved.name,
      createdAt: saved.createdAt.toISOString(),
      expiresAt: saved.expiresAt ? saved.expiresAt.toISOString() : null,
    };
  }

  async listApiKeys(user: AuthUser) {
    const keys = await this.apiKeyRepository.find({
      where: { userId: Number.parseInt(user.sub, 10) },
      order: { createdAt: "DESC" },
    });

    return keys.map((key) => ({
      id: key.id,
      keyPrefix: key.keyPrefix,
      name: key.name,
      lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
      createdAt: key.createdAt.toISOString(),
      expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    }));
  }

  async deleteApiKey(user: AuthUser, keyId: number) {
    const key = await this.apiKeyRepository.findOne({ where: { id: keyId } });
    if (!key || key.userId !== Number.parseInt(user.sub, 10)) {
      throw new HttpError(403, "PROFILE_FORBIDDEN", "API key not found or access denied");
    }

    await this.apiKeyRepository.remove(key);
    return { deleted: true };
  }
}

class RunsService {
  constructor(
    private readonly testRunRepository: Repository<TestRun>,
    private readonly testResultRepository: Repository<TestResult>,
    private readonly projectsService: LegacyProjectsService,
    private readonly notifications?: Pick<NotificationsNativeService, "dispatchRunCompleted">,
  ) {}

  private async resolveProjectId(projectId?: string): Promise<string> {
    return this.projectsService.resolveProjectId(projectId);
  }

  private parseDateBoundary(rawValue: string | undefined, boundary: "start" | "end"): Date | null {
    const value = rawValue?.trim();
    if (!value) {
      return null;
    }

    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (isDateOnly) {
      const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
      const parsed =
        boundary === "start"
          ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
          : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private emptyStats(): TestRunStats {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      broken: 0,
      passRate: 0,
    };
  }

  private async buildRunStats(runIds: number[]): Promise<Map<number, TestRunStats>> {
    const statsByRunId = new Map<number, TestRunStats>();
    for (const runId of runIds) {
      statsByRunId.set(runId, this.emptyStats());
    }

    if (runIds.length === 0) {
      return statsByRunId;
    }

    const rows = await this.testResultRepository
      .createQueryBuilder("testResult")
      .select("testResult.testRunId", "testRunId")
      .addSelect("testResult.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("testResult.testRunId IN (:...runIds)", { runIds })
      .groupBy("testResult.testRunId")
      .addGroupBy("testResult.status")
      .getRawMany();

    for (const row of rows as Array<{ testRunId: string; status: string; count: string }>) {
      const runId = Number.parseInt(row.testRunId, 10);
      const count = Number.parseInt(row.count, 10);
      const status = row.status.toLowerCase();
      const stats = statsByRunId.get(runId) ?? this.emptyStats();

      stats.total += count;
      if (status === "passed") stats.passed += count;
      else if (status === "failed") stats.failed += count;
      else if (status === "skipped") stats.skipped += count;
      else stats.broken += count;

      stats.passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
      statsByRunId.set(runId, stats);
    }

    return statsByRunId;
  }

  async createTestRun(
    dto: {
      name: string;
      tags?: string[];
      environment?: string;
      branch?: string;
      uuid?: string;
    },
    projectId?: string,
  ): Promise<TestRun> {
    const scopedProjectId = await this.resolveProjectId(projectId);
    const testRun = this.testRunRepository.create({
      name: dto.name,
      status: "running",
      startTime: new Date(),
      tags: dto.tags || [],
      environment: dto.environment,
      branch: dto.branch,
      uuid: dto.uuid || randomUUID(),
      projectId: scopedProjectId,
    });

    return this.testRunRepository.save(testRun);
  }

  async completeTestRun(id: number | string, projectId?: string): Promise<TestRun> {
    const run = await this.getTestRun(id, projectId);
    run.status = "completed";
    run.endTime = new Date();
    const saved = await this.testRunRepository.save(run);

    if (this.notifications) {
      try {
        await this.notifications.dispatchRunCompleted(saved, projectId || saved.projectId || "default");
      } catch (error) {
        console.warn(
          `Notification dispatch failed for run ${saved.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return saved;
  }

  async failTestRun(id: number | string, projectId?: string): Promise<TestRun> {
    const run = await this.getTestRun(id, projectId);
    run.status = "failed";
    run.endTime = new Date();
    return this.testRunRepository.save(run);
  }

  async getTestRun(id: number | string, projectId?: string): Promise<TestRun> {
    const numericId = typeof id === "string" ? Number.parseInt(id, 10) : id;
    const scopedProjectId = await this.resolveProjectId(projectId);

    const testRun = await this.testRunRepository
      .createQueryBuilder("run")
      .where("run.id = :id", { id: numericId })
      .andWhere(
        "(run.projectId = :projectId OR (:projectId = 'default' AND run.projectId IS NULL))",
        { projectId: scopedProjectId },
      )
      .getOne();

    if (!testRun) {
      throw new HttpError(404, "RUN_NOT_FOUND", `Test run not found: ${id}`);
    }

    const statsByRunId = await this.buildRunStats([testRun.id]);
    testRun.stats = statsByRunId.get(testRun.id) ?? this.emptyStats();
    return testRun;
  }

  async getTestRuns(options: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    projectId?: string;
  }) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 10;
    const scopedProjectId = await this.resolveProjectId(options.projectId);

    const query = this.testRunRepository
      .createQueryBuilder("run")
      .where(
        "(run.projectId = :projectId OR (:projectId = 'default' AND run.projectId IS NULL))",
        { projectId: scopedProjectId },
      );

    if (options.status?.trim()) {
      query.andWhere("run.status = :status", { status: options.status.trim() });
    }

    if (options.search?.trim()) {
      query.andWhere("run.name ILIKE :search", { search: `%${options.search.trim()}%` });
    }

    const dateFrom = this.parseDateBoundary(options.dateFrom, "start");
    if (dateFrom) {
      query.andWhere("run.startTime >= :dateFrom", { dateFrom: dateFrom.toISOString() });
    }

    const dateTo = this.parseDateBoundary(options.dateTo, "end");
    if (dateTo) {
      query.andWhere("run.startTime <= :dateTo", { dateTo: dateTo.toISOString() });
    }

    const sortBy = ["startTime", "name", "status"].includes(options.sortBy || "")
      ? options.sortBy!
      : "startTime";
    const sortOrder = options.sortOrder === "asc" ? "ASC" : "DESC";

    const [items, total] = await query
      .orderBy(`run.${sortBy}`, sortOrder)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    if (items.length > 0) {
      const statsByRunId = await this.buildRunStats(items.map((item) => item.id));
      for (const item of items) {
        item.stats = statsByRunId.get(item.id) ?? this.emptyStats();
      }
    }

    return { items, total, page, limit };
  }

  async getTestResults(id: number | string, projectId?: string): Promise<TestResult[]> {
    const run = await this.getTestRun(id, projectId);
    return this.testResultRepository.find({
      where: { testRunId: run.id },
      order: { startTime: "DESC" },
      relations: ["steps", "steps.childSteps", "steps.attachments", "steps.childSteps.attachments"],
    });
  }
}

class DashboardService {
  private readonly metricsCache = new Map<
    string,
    {
      generatedAt: string;
      expiresAt: number;
      payload: Omit<DashboardMetricsResponse, "cache">;
    }
  >();

  private readonly metricsCacheTtlSeconds = 60;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly dataSource: DataSource,
  ) {}

  async getDashboards(userId: string, projectId: string) {
    const key = this.buildKey(projectId, userId);
    const current = await this.loadState(key);
    const { state, changed } = this.normalizeState(current ?? this.buildDefaultState());
    if (!current || changed) {
      await this.saveState(key, state);
    }

    return state;
  }

  async createDashboard(userId: string, projectId: string, input: CreateDashboardInput) {
    const key = this.buildKey(projectId, userId);
    const { state } = this.normalizeState((await this.loadState(key)) ?? this.buildDefaultState());

    const dashboard: DashboardConfig = {
      id: randomUUID(),
      name: input.name?.trim() || `Dashboard ${state.dashboards.length + 1}`,
      isDefault: input.isDefault ?? false,
      order: input.order ?? state.dashboards.length,
      widgets: input.widgets ?? [],
      updatedAt: new Date().toISOString(),
    };

    if (dashboard.isDefault) {
      state.dashboards.forEach((item) => {
        item.isDefault = false;
      });
    }

    state.dashboards.push(dashboard);
    const { state: ensured } = this.normalizeState(state);
    await this.saveState(key, ensured);
    return { dashboards: ensured.dashboards, dashboard };
  }

  async updateDashboard(userId: string, projectId: string, dashboardId: string, input: UpdateDashboardInput) {
    const key = this.buildKey(projectId, userId);
    const { state } = this.normalizeState((await this.loadState(key)) ?? this.buildDefaultState());
    const dashboard = state.dashboards.find((item) => item.id === dashboardId);

    if (!dashboard) {
      throw new HttpError(404, "DASHBOARD_NOT_FOUND", "Dashboard not found");
    }

    if (typeof input.name === "string") {
      dashboard.name = input.name.trim() || dashboard.name;
    }
    if (typeof input.order === "number") {
      dashboard.order = input.order;
    }
    if (Array.isArray(input.widgets)) {
      dashboard.widgets = input.widgets;
    }
    if (typeof input.isDefault === "boolean") {
      if (input.isDefault) {
        state.dashboards.forEach((item) => {
          item.isDefault = false;
        });
      }
      dashboard.isDefault = input.isDefault;
    }

    dashboard.updatedAt = new Date().toISOString();
    const { state: ensured } = this.normalizeState(state);
    await this.saveState(key, ensured);
    return { dashboards: ensured.dashboards, dashboard };
  }

  async deleteDashboard(userId: string, projectId: string, dashboardId: string) {
    const key = this.buildKey(projectId, userId);
    const { state } = this.normalizeState((await this.loadState(key)) ?? this.buildDefaultState());
    const index = state.dashboards.findIndex((item) => item.id === dashboardId);

    if (index === -1) {
      throw new HttpError(404, "DASHBOARD_NOT_FOUND", "Dashboard not found");
    }

    const [removed] = state.dashboards.splice(index, 1);
    const { state: ensured } = this.normalizeState(state);
    await this.saveState(key, ensured);
    return { dashboards: ensured.dashboards, removed };
  }

  getDashboardMeta() {
    return {
      visualizations: [
        { id: "stat", label: "Stat" },
        { id: "line", label: "Line" },
        { id: "bar", label: "Bar" },
        { id: "area", label: "Area" },
        { id: "pie", label: "Pie" },
        { id: "table", label: "Table" },
      ],
      dataSources: [
        { id: "test-summary", label: "Test Summary" },
        { id: "test-trend", label: "Test Trend" },
        { id: "recent-runs", label: "Recent Runs" },
        { id: "pass-rate", label: "Pass Rate" },
        { id: "latest-run-status", label: "Latest Run Status" },
        { id: "pass-fail-trend", label: "Pass/Fail Trend" },
        { id: "flaky-rate", label: "Flaky Rate" },
        { id: "top-failing-tests", label: "Top Failing Tests" },
        { id: "top-failing-suites", label: "Top Failing Suites" },
      ],
    };
  }

  async getDashboardMetrics(userId: string, projectId: string, filters: DashboardMetricsFilters, forceRefresh = false) {
    const normalizedFilters = this.normalizeMetricsFilters(filters);
    const cacheKey = `dashboard-metrics:${projectId}:${userId}:${JSON.stringify(normalizedFilters)}`;
    const now = Date.now();
    const cached = this.metricsCache.get(cacheKey);

    if (!forceRefresh && cached && cached.expiresAt > now) {
      return {
        ...cached.payload,
        cache: {
          key: cacheKey,
          hit: true,
          generatedAt: cached.generatedAt,
          expiresAt: new Date(cached.expiresAt).toISOString(),
          ttlSeconds: this.metricsCacheTtlSeconds,
        },

      };
    }

    const generatedAt = new Date().toISOString();
    const payload = await this.computeDashboardMetrics(projectId, normalizedFilters);
    const expiresAt = now + this.metricsCacheTtlSeconds * 1000;
    this.metricsCache.set(cacheKey, { generatedAt, expiresAt, payload });

    return {
      ...payload,
      cache: {
        key: cacheKey,
        hit: false,
        generatedAt,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlSeconds: this.metricsCacheTtlSeconds,
      },
    };
  }

  private normalizeMetricsFilters(filters: DashboardMetricsFilters): DashboardMetricsFilters {
    const normalizeText = (value?: string) => {
      const trimmed = value?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : undefined;
    };

    const normalizedTags = (filters.tags ?? [])
      .flatMap((value) => value.split(","))
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);

    return {
      dateFrom: normalizeText(filters.dateFrom),
      dateTo: normalizeText(filters.dateTo),
      branch: normalizeText(filters.branch),
      environment: normalizeText(filters.environment),
      status: normalizeText(filters.status)?.toLowerCase(),
      tags: Array.from(new Set(normalizedTags)),
    };
  }

  private buildKey(projectId: string, userId: string) {
    return `dashboards:${projectId}:${userId}`;
  }

  private async loadState(key: string): Promise<DashboardState | null> {
    const value = await this.settingsStore.get(key);
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as DashboardState;
      return parsed && Array.isArray(parsed.dashboards) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async saveState(key: string, state: DashboardState) {
    await this.settingsStore.set(key, JSON.stringify(state));
  }

  private normalizeState(state: DashboardState): { state: DashboardState; changed: boolean } {
    let changed = false;
    if (!state?.dashboards?.length) {
      return { state: this.buildDefaultState(), changed: true };
    }

    let defaultIndex = state.dashboards.findIndex((item) => item.isDefault);
    if (defaultIndex === -1) {
      defaultIndex = 0;
      state.dashboards[0].isDefault = true;
      changed = true;
    }

    state.dashboards.forEach((item, index) => {
      if (index !== defaultIndex && item.isDefault) {
        item.isDefault = false;
        changed = true;
      }
      if (typeof item.order !== "number") {
        item.order = index;
        changed = true;
      }
    });

    return { state, changed };
  }

  private buildDefaultState(): DashboardState {
    const now = new Date().toISOString();
    return {
      dashboards: [
        {
          id: randomUUID(),
          name: "Default Dashboard",
          isDefault: true,
          order: 0,
          updatedAt: now,
          widgets: [
            {
              id: randomUUID(),
              title: "Test Summary",
              visualization: "stat",
              dataSource: "test-summary",
              layout: { x: 0, y: 0, w: 4, h: 2 },
            },
            {
              id: randomUUID(),
              title: "Test Results Trend",
              visualization: "line",
              dataSource: "pass-fail-trend",
              layout: { x: 4, y: 0, w: 8, h: 4 },
            },
          ],
        },
      ],
    };
  }

  private buildEmptyMetrics(filters: DashboardMetricsFilters) {
    return {
      filters,
      summary: {
        totalRuns: 0,
        totalTests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        broken: 0,
        passRate: 0,
      },
      passFailTrend: [],
      flakyRate: {
        percentage: 0,
        flakyTests: 0,
        trackedTests: 0,
      },
      topFailingTests: [],
      topFailingSuites: [],
    };
  }

  private normalizeResultStatus(status: string): "passed" | "failed" | "skipped" | "broken" {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "passed") return "passed";
    if (normalized === "failed") return "failed";
    if (normalized === "skipped") return "skipped";
    return "broken";
  }

  private formatTrendDate(dateValue?: Date): string {
    if (!dateValue) {
      return "unknown";
    }

    const date = new Date(dateValue);
    return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
  }

  private extractSuiteName(testName: string): string {
    if (testName.includes("::")) return testName.split("::").slice(0, -1).join("::") || "General";
    if (testName.includes(" > ")) return testName.split(" > ").slice(0, -1).join(" > ") || "General";
    if (testName.includes(".")) return testName.split(".").slice(0, -1).join(".") || "General";
    return "General";
  }

  private async computeDashboardMetrics(projectId: string, filters: DashboardMetricsFilters) {
    const runRepository = this.dataSource.getRepository(TestRun);
    const resultRepository = this.dataSource.getRepository(TestResult);
    const runQuery = runRepository.createQueryBuilder("run");

    if (projectId === DEFAULT_PROJECT_ID) {
      runQuery.andWhere("(run.projectId = :projectId OR run.projectId IS NULL)", { projectId });
    } else {
      runQuery.andWhere("run.projectId = :projectId", { projectId });
    }

    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
      runQuery.andWhere("run.startTime >= :dateFrom", { dateFrom: dateFrom.toISOString() });
    }

    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;
    if (dateTo && !Number.isNaN(dateTo.getTime())) {
      dateTo.setHours(23, 59, 59, 999);
      runQuery.andWhere("run.startTime <= :dateTo", { dateTo: dateTo.toISOString() });
    }

    if (filters.branch) {
      runQuery.andWhere("LOWER(run.branch) = LOWER(:branch)", { branch: filters.branch });
    }
    if (filters.environment) {
      runQuery.andWhere("LOWER(run.environment) = LOWER(:environment)", { environment: filters.environment });
    }
    if (filters.status) {
      runQuery.andWhere("LOWER(run.status) = LOWER(:status)", { status: filters.status });
    }
    if (filters.tags?.length) {
      const params: Record<string, string> = {};
      const conditions = filters.tags.map((tag, index) => {
        params[`tag${index}`] = `%${tag}%`;
        return `LOWER(CAST(run.tags AS text)) LIKE :tag${index}`;
      });
      runQuery.andWhere(`(${conditions.join(" OR ")})`, params);
    }

    const runs = await runQuery.orderBy("run.startTime", "DESC").getMany();
    if (runs.length === 0) {
      return this.buildEmptyMetrics(filters);
    }

    const runIds = runs.map((run) => run.id);
    const results = await resultRepository
      .createQueryBuilder("result")
      .where("result.testRunId IN (:...runIds)", { runIds })
      .orderBy("result.startTime", "DESC")
      .getMany();

    const summary: DashboardMetricsSummary = {
      totalRuns: runs.length,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      broken: 0,
      passRate: 0,
    };

    const trendMap = new Map<string, DashboardPassFailTrendPoint>();
    const runDateById = new Map<number, string>();
    const testHistory = new Map<string, { failures: number; statuses: Set<string>; lastStatus: string; lastRunAt?: string }>();
    const suiteFailures = new Map<string, { failures: number; tests: Set<string> }>();

    for (const run of runs) {
      const date = this.formatTrendDate(run.startTime);
      runDateById.set(run.id, date);
      if (!trendMap.has(date)) {
        trendMap.set(date, { date, passed: 0, failed: 0, skipped: 0, broken: 0, total: 0 });
      }
    }

    for (const result of results) {
      const status = this.normalizeResultStatus(String(result.status));
      const testName = result.name?.trim() || "Unnamed test";
      const startedAt = result.startTime ? new Date(result.startTime).toISOString() : undefined;

      summary.totalTests += 1;
      if (status === "passed") summary.passed += 1;
      else if (status === "failed") summary.failed += 1;
      else if (status === "skipped") summary.skipped += 1;
      else summary.broken += 1;

      const trendDate = runDateById.get(Number(result.testRunId));
      if (trendDate) {
        const point = trendMap.get(trendDate)!;
        point.total += 1;
        if (status === "passed") point.passed += 1;
        else if (status === "failed") point.failed += 1;
        else if (status === "skipped") point.skipped += 1;
        else point.broken += 1;
      }

      const history = testHistory.get(testName) ?? {
        failures: 0,
        statuses: new Set<string>(),
        lastStatus: status,
      };
      history.statuses.add(status);
      if (status === "failed" || status === "broken") {
        history.failures += 1;
      }
      if (startedAt && (!history.lastRunAt || startedAt > history.lastRunAt)) {
        history.lastRunAt = startedAt;
        history.lastStatus = status;
      }
      testHistory.set(testName, history);

      const suiteName = this.extractSuiteName(testName);
      const suite = suiteFailures.get(suiteName) ?? { failures: 0, tests: new Set<string>() };
      suite.tests.add(testName);
      if (status === "failed" || status === "broken") {
        suite.failures += 1;
      }
      suiteFailures.set(suiteName, suite);
    }

    summary.passRate = summary.totalTests > 0 ? Number(((summary.passed / summary.totalTests) * 100).toFixed(1)) : 0;

    const topFailingTests = Array.from(testHistory.entries())
      .map(([name, value]) => ({
        name,
        failures: value.failures,
        flakyRuns:
          value.statuses.has("passed") && (value.statuses.has("failed") || value.statuses.has("broken"))
            ? value.failures
            : 0,
        lastStatus: value.lastStatus,
        lastRunAt: value.lastRunAt,
      }))
      .filter((value) => value.failures > 0)
      .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name))
      .slice(0, 5);

    const trackedTests = testHistory.size;
    const flakyTests = Array.from(testHistory.values()).filter(
      (value) => value.statuses.has("passed") && (value.statuses.has("failed") || value.statuses.has("broken")),
    ).length;

    const topFailingSuites = Array.from(suiteFailures.entries())
      .map(([name, value]) => ({ name, failures: value.failures, tests: value.tests.size }))
      .filter((value) => value.failures > 0)
      .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name))
      .slice(0, 5);

    return {
      filters,
      summary,
      passFailTrend: Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      flakyRate: {
        percentage: trackedTests > 0 ? Number(((flakyTests / trackedTests) * 100).toFixed(1)) : 0,
        flakyTests,
        trackedTests,
      },
      topFailingTests,
      topFailingSuites,
    };
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ SimpleSettingsService Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export class SimpleSettingsService {
  constructor(private readonly repo: Repository<Settings>) {}

  private buildKey(key: string, projectId?: string): string {
    return projectId ? `${key}:${projectId}` : key;
  }

  async get(key: string, projectId?: string): Promise<string | null> {
    const fullKey = this.buildKey(key, projectId);
    const row = await this.repo.findOne({ where: { key: fullKey } });
    return row?.value ?? null;
  }

  async set(key: string, value: string, projectId?: string): Promise<void> {
    const fullKey = this.buildKey(key, projectId);
    const existing = await this.repo.findOne({ where: { key: fullKey } });
    if (existing) {
      existing.value = value;
      await this.repo.save(existing);
    } else {
      const row = this.repo.create({ key: fullKey, value });
      await this.repo.save(row);
    }
  }

  async delete(key: string, projectId?: string): Promise<void> {
    const fullKey = this.buildKey(key, projectId);
    await this.repo.delete({ key: fullKey });
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ UsersNativeService Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬


export class UsersNativeService {
  constructor(private readonly repo: Repository<User>) {}

  async list(): Promise<User[]> {
    return this.repo.find({ order: { id: "ASC" } });
  }

  async findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(data: { name: string; email: string; password: string; role?: string }): Promise<User> {
    const hashedPassword = await bcryptHash(data.password, 12);
    const user = this.repo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
      role: (data.role as "admin" | "user") ?? "user",
    });
    return this.repo.save(user);
  }

  async update(id: number, data: { name?: string; email?: string; password?: string; role?: string }): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    if (data.name) user.name = data.name;
    if (data.email) user.email = data.email;
    if (data.password) {
      user.password = await bcryptHash(data.password, 12);
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    }
    if (data.role) user.role = data.role as "admin" | "user";
    return this.repo.save(user);
  }

  async remove(id: number): Promise<void> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    await this.repo.remove(user);
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ NotificationsNativeService Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const NOTIF_RULES_KEY = "notification:rules";
const NOTIF_CONTRACT_VERSION = "1.0";

type NotificationRunEvent = "run-broken" | "run-completion" | "run-failed";
type NotificationDeliveryMode = "summary" | "per-test";

type NotificationDispatchResult = {
  destinationId: string;
  status: NotificationDelivery["status"];
  error?: string;
  responseCode?: number;
};

type NotificationDispatchSummary = {
  sent: number;
  failed: number;
  skipped: number;
  results: NotificationDispatchResult[];
};

export class NotificationsNativeService {
  constructor(
    private readonly deliveryRepo: Repository<NotificationDelivery>,
    private readonly testResultRepo: Repository<TestResult>,
    private readonly settings: SimpleSettingsService,
    private readonly outboundAllowedHosts: string[] = [],
  ) {}

  async getRulesRaw(projectId: string): Promise<unknown> {
    const raw = await this.settings.get(NOTIF_RULES_KEY, projectId);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async setRulesRaw(projectId: string, rules: unknown): Promise<void> {
    await this.settings.set(NOTIF_RULES_KEY, JSON.stringify(rules), projectId);
  }

  async getContract(): Promise<unknown> {
    return {
      version: NOTIF_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      eventTypes: ["run-completion", "run-failed", "run-broken"],
      destinationTypes: ["slack", "telegram", "email", "webhook"],
      deliveryModes: ["summary", "per-test"],
      messageModes: ["summary", "failures", "summary+failures"],
      defaults: {
        rules: {
          enabled: false,
          events: ["run-completion"],
          deliveryMode: "summary",
          deliveryDelaySeconds: 0,
          messageMode: "summary",
          sendWhenFailedOnly: false,
          sendCompletionNotice: true,
        },
        templates: {
          summary: "Test run completed: {{run.name}}",
          failure: "Test run failed: {{run.name}}",
        },
      },
    };
  }

  async dispatchRunCompleted(run: TestRun, projectId?: string): Promise<NotificationDispatchSummary> {
    const scopedProjectId = projectId || run.projectId || "default";
    const rules = await this.getRulesRaw(scopedProjectId);
    if (!notificationsEnabled(rules)) return emptyNotificationDispatch();

    const event = selectRunNotificationEvent(run, rules);
    if (!event) return emptyNotificationDispatch();

    const destinations = extractDestinations(rules).filter((d) => d.enabled !== false);
    if (destinations.length === 0) return emptyNotificationDispatch();

    const results: NotificationDispatchResult[] = [];
    const deliveryMode = getNotificationDeliveryMode(rules);
    const deliveryDelayMs = getNotificationDeliveryDelayMs(rules);
    const sendCompletionNotice = getNotificationSendCompletionNotice(rules);
    const testResults = deliveryMode === "per-test" ? await this.loadRunTestResults(run.id) : [];

    for (const destination of destinations) {
      if (deliveryMode === "per-test") {
        results.push(
          ...(await this.dispatchTestSeries(
            scopedProjectId,
            event,
            destination,
            run,

            testResults,
            deliveryDelayMs,
            sendCompletionNotice,
          )),
        );
        continue;
      }

      const payload = buildRunNotificationPayload(run, scopedProjectId, event);
      results.push(await this.dispatchDestination(scopedProjectId, event, destination, payload, run.id, "summary"));
    }

    return summarizeNotificationDispatch(results);
  }

  async listHistory(projectId: string, opts: { limit?: number; status?: string; runId?: string }): Promise<NotificationDelivery[]> {
    const qb = this.deliveryRepo.createQueryBuilder("nd")
      .where("nd.projectId = :projectId", { projectId })
      .orderBy("nd.createdAt", "DESC")
      .take(opts.limit ?? 50);
    if (opts.status) qb.andWhere("nd.status = :status", { status: opts.status });
    if (opts.runId) qb.andWhere("nd.runId = :runId", { runId: Number(opts.runId) });
    return qb.getMany();
  }

  async dispatchTestDelivery(projectId: string, destinationId?: string): Promise<{ sent: number; failed: number; skipped: number; results: Array<{ destinationId: string; status: "failed" | "sent" | "skipped"; error?: string }> }> {
    const rules = await this.getRulesRaw(projectId);
    const destinations = extractDestinations(rules).filter(
      (d) => d.enabled !== false && (!destinationId || d.id === destinationId),
    );

    const payload = {
      event: "test-run.completed",
      projectId,
      runName: "Test notification",
      status: "completed",
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
      sentAt: new Date().toISOString(),
      message: "This is a test delivery from Veriqorn notifications.",
    };

    const results: Array<{ destinationId: string; status: "failed" | "sent" | "skipped"; error?: string }> = [];
    for (const destination of destinations) {
      if (!destination.url) {
        results.push({ destinationId: destination.id, status: "skipped", error: "Destination has no URL configured" });
        continue;
      }
      try {
        const url = (await assertSafeOutboundUrl(destination.url, this.outboundAllowedHosts)).toString();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "error",
          body: JSON.stringify(
            destination.type === "slack"
              ? { text: `${payload.runName}: ${payload.status} (${payload.passed}/${payload.total} passed)` }
              : payload,
          ),
        });
        if (!response.ok) {
          results.push({ destinationId: destination.id, status: "failed", error: `HTTP ${response.status}` });
        } else {
          results.push({ destinationId: destination.id, status: "sent" });
        }
      } catch (error) {
        results.push({
          destinationId: destination.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const last = results[results.length - 1];
        const normalizedType: NotificationDelivery["destinationType"] =
          destination.type === "slack" || destination.type === "telegram" || destination.type === "email"
            ? destination.type
            : "webhook";
        const record: Partial<NotificationDelivery> = {
          projectId,
          event: "test.manual",
          destinationId: destination.id,
          destinationType: normalizedType,
          status: last.status,
          attempt: 1,
          triggeredBy: "manual-test",
          dedupeKey: `test-delivery:${destination.id}:${Date.now()}`,
        };
        if (last.error) record.errorMessage = last.error;
        if (last.status === "sent") record.deliveredAt = new Date();
        await this.deliveryRepo.save(this.deliveryRepo.create(record));
      } catch { /* best-effort logging */ }
    }

    return {
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
    };
  }

  private async dispatchDestination(
    projectId: string,
    event: NotificationRunEvent,
    destination: ExtractedDestination,
    payload: Record<string, unknown>,
    runId: number,
    dedupeSuffix = "summary",
  ): Promise<NotificationDispatchResult> {
    const destinationType = normalizeDestinationType(destination.type);
    const dedupeKey = `notification:${projectId}:${event}:${runId}:${destination.id}:${dedupeSuffix}`;

    try {
      const existing = await this.deliveryRepo.findOne({ where: { dedupeKey } });
      if (existing?.status === "sent") {
        return { destinationId: destination.id, status: "skipped", error: "Notification already delivered for this run" };
      }
    } catch {
      // Best-effort idempotency; delivery still proceeds if lookup fails.
    }

    if (!destination.url) {
      await this.saveDelivery({
        projectId,
        event,
        destinationId: destination.id,
        destinationType,
        status: "skipped",
        runId,
        dedupeKey,
        errorMessage: "Destination has no URL configured",
      });
      return { destinationId: destination.id, status: "skipped", error: "Destination has no URL configured" };
    }

    const chart = payload.chart && typeof payload.chart === "object" ? payload.chart as Record<string, unknown> : null;
    const requestPayload = destinationType === "slack"
      ? {
          text: `${String(payload.title ?? "Notification")}\n${String(payload.message ?? "")}`,
          ...(chart
            ? {
                chart,
                image: {
                  dataUrl: typeof chart.dataUrl === "string" ? chart.dataUrl : undefined,
                  mimeType: typeof chart.mimeType === "string" ? chart.mimeType : undefined,
                },
              }
            : {}),
        }
      : payload;

    try {
      const url = (await assertSafeOutboundUrl(destination.url, this.outboundAllowedHosts)).toString();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
        redirect: "error",
      });
      const status: NotificationDelivery["status"] = response.ok ? "sent" : "failed";
      const errorMessage = response.ok ? undefined : `HTTP ${response.status}`;
      await this.saveDelivery({
        projectId,
        event,
        destinationId: destination.id,
        destinationType,
        status,
        runId,
        dedupeKey,
        responseCode: response.status,
        requestPayload: JSON.stringify(requestPayload),
        ...(errorMessage ? { errorMessage } : {}),
        ...(status === "sent" ? { deliveredAt: new Date() } : {}),
      });
      return {
        destinationId: destination.id,
        status,
        ...(errorMessage ? { error: errorMessage } : {}),
        responseCode: response.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.saveDelivery({
        projectId,
        event,
        destinationId: destination.id,
        destinationType,
        status: "failed",
        runId,
        dedupeKey,
        requestPayload: JSON.stringify(requestPayload),
        errorMessage: message,
      });
      return { destinationId: destination.id, status: "failed", error: message };
    }
  }

  private async dispatchTestSeries(
    projectId: string,
    event: NotificationRunEvent,
    destination: ExtractedDestination,
    run: TestRun,
    testResults: TestResult[],
    deliveryDelayMs: number,
    sendCompletionNotice: boolean,
  ): Promise<NotificationDispatchResult[]> {
    const results: NotificationDispatchResult[] = [];
    const series = testResults.length > 0 ? testResults : [];

    if (series.length === 0) {
      results.push(
        await this.dispatchDestination(
          projectId,
          event,
          destination,
          buildRunNotificationPayload(run, projectId, event),
          run.id,
          "summary",
        ),
      );
    } else {
      for (let index = 0; index < series.length; index += 1) {
        if (index > 0 && deliveryDelayMs > 0) {
          await sleep(deliveryDelayMs);
        }
        const testResult = series[index];
        results.push(
          await this.dispatchDestination(
            projectId,
            event,
            destination,
            buildRunTestNotificationPayload(run, projectId, event, testResult, index + 1, series.length),
            run.id,
            `test-${testResult.id}`,
          ),
        );
      }
    }

    if (sendCompletionNotice) {
      if (series.length > 0 && deliveryDelayMs > 0) {
        await sleep(deliveryDelayMs);
      }
      results.push(
        await this.dispatchDestination(
          projectId,
          event,
          destination,
          buildRunCompletionNoticePayload(run, projectId, event, series.length),
          run.id,
          "completion",
        ),
      );
    }

    return results;
  }

  private async loadRunTestResults(runId: number): Promise<TestResult[]> {
    return this.testResultRepo.find({
      where: { testRunId: runId },
      order: { startTime: "ASC", name: "ASC" },
    });
  }

  private async saveDelivery(record: Partial<NotificationDelivery>): Promise<void> {
    await this.deliveryRepo.save(
      this.deliveryRepo.create({
        attempt: 1,
        triggeredBy: "run-completion",
        ...record,
      }),
    );
  }
}

interface ExtractedDestination {
  id: string;
  type: string;
  url?: string;
  enabled?: boolean;
}

const extractDestinations = (rules: unknown): ExtractedDestination[] => {
  if (!rules || typeof rules !== "object") return [];
  const record = rules as Record<string, unknown>;
  const nestedRules = record.rules && typeof record.rules === "object" ? record.rules as Record<string, unknown> : null;
  const raw = Array.isArray(record.destinations)
    ? record.destinations
    : nestedRules && Array.isArray(nestedRules.destinations)
      ? nestedRules.destinations
      : [];
  const out: ExtractedDestination[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) continue;
    const url = typeof item.url === "string" ? item.url : typeof item.webhookUrl === "string" ? (item.webhookUrl as string) : undefined;
    out.push({
      id,
      type: typeof item.type === "string" ? item.type : "webhook",
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      ...(url ? { url } : {}),
    });
  }
  return out;
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ KbNativeService Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const emptyNotificationDispatch = (): NotificationDispatchSummary => ({
  failed: 0,
  results: [],
  sent: 0,
  skipped: 0,
});

const summarizeNotificationDispatch = (results: NotificationDispatchResult[]): NotificationDispatchSummary => ({
  failed: results.filter((r) => r.status === "failed").length,
  results,
  sent: results.filter((r) => r.status === "sent").length,
  skipped: results.filter((r) => r.status === "skipped").length,
});

const notificationsEnabled = (rules: unknown): boolean => {
  if (!rules || typeof rules !== "object") return false;
  const record = rules as Record<string, unknown>;
  return record.enabled !== false;
};

const getNotificationEvents = (rules: unknown): NotificationRunEvent[] => {
  if (!rules || typeof rules !== "object") return ["run-completion"];
  const record = rules as Record<string, unknown>;
  const nestedRules = record.rules && typeof record.rules === "object" ? record.rules as Record<string, unknown> : null;
  const raw = Array.isArray(record.events)
    ? record.events
    : nestedRules && Array.isArray(nestedRules.events)
      ? nestedRules.events
      : ["run-completion"];
  const allowed = new Set<NotificationRunEvent>(["run-broken", "run-completion", "run-failed"]);
  const events = raw.filter((event): event is NotificationRunEvent => allowed.has(event as NotificationRunEvent));
  return events.length > 0 ? events : ["run-completion"];
};

const selectRunNotificationEvent = (run: TestRun, rules: unknown): NotificationRunEvent | null => {
  const events = getNotificationEvents(rules);
  const broken = run.stats?.broken ?? 0;
  const failed = run.stats?.failed ?? 0;
  const specific: NotificationRunEvent = broken > 0 ? "run-broken" : failed > 0 ? "run-failed" : "run-completion";

  if (specific !== "run-completion" && events.includes(specific)) return specific;
  if (events.includes("run-completion")) return "run-completion";
  if (specific === "run-completion" && events.includes(specific)) return specific;
  return null;
};

const normalizeDestinationType = (type: string): NotificationDelivery["destinationType"] =>
  type === "slack" || type === "telegram" || type === "email" ? type : "webhook";

const buildRunNotificationPayload = (
  run: TestRun,
  projectId: string,
  event: NotificationRunEvent,
): Record<string, unknown> => {
  const stats = run.stats ?? { broken: 0, failed: 0, passRate: 0, passed: 0, skipped: 0, total: 0 };
  const title = event === "run-failed"
    ? `Test run failed: ${run.name}`
    : event === "run-broken"
      ? `Test run has broken tests: ${run.name}`
      : `Test run completed: ${run.name}`;
  const message = [
    `Status: ${run.status}`,
    `Passed: ${stats.passed}/${stats.total}`,
    `Failed: ${stats.failed}`,
    `Broken: ${stats.broken}`,
    `Skipped: ${stats.skipped}`,
    run.branch ? `Branch: ${run.branch}` : null,
    run.environment ? `Environment: ${run.environment}` : null,
  ].filter(Boolean).join("\n");

  return {
    event,
    title,
    message,
    projectId,
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      branch: run.branch ?? null,
      environment: run.environment ?? null,
      startTime: run.startTime ? run.startTime.toISOString() : null,
      endTime: run.endTime ? run.endTime.toISOString() : null,
      stats,
    },
    chart: buildRunSummaryChart(stats),
    sentAt: new Date().toISOString(),
  };
};

const buildRunTestNotificationPayload = (
  run: TestRun,
  projectId: string,
  event: NotificationRunEvent,
  testResult: TestResult,
  position: number,
  total: number,
): Record<string, unknown> => ({
  event,
  kind: "test",
  title: `Test ${position}/${total}: ${testResult.name}`,
  message: [
    `Run: ${run.name}`,
    `Test: ${testResult.name}`,
    `Status: ${testResult.status}`,
    `Run status: ${run.status}`,
    run.branch ? `Branch: ${run.branch}` : null,
    run.environment ? `Environment: ${run.environment}` : null,
  ].filter(Boolean).join("\n"),
  projectId,
  run: {
    id: run.id,
    name: run.name,
    status: run.status,
    branch: run.branch ?? null,
    environment: run.environment ?? null,
    startTime: run.startTime ? run.startTime.toISOString() : null,
    endTime: run.endTime ? run.endTime.toISOString() : null,
    stats: run.stats ?? null,
  },
  test: {
    id: testResult.id,
    name: testResult.name,
    status: testResult.status,
    duration: testResult.duration ?? null,
  },
  sentAt: new Date().toISOString(),
});

const buildRunCompletionNoticePayload = (
  run: TestRun,
  projectId: string,
  event: NotificationRunEvent,
  deliveredCount: number,
): Record<string, unknown> => ({
  event,
  kind: "completion",
  title: `Notification delivery complete: ${run.name}`,
  message: deliveredCount > 0
    ? `Sent ${deliveredCount} test notification${deliveredCount === 1 ? "" : "s"} for this run.`
    : "No test notifications were sent.",
  projectId,
  run: {
    id: run.id,
    name: run.name,
    status: run.status,
    branch: run.branch ?? null,
    environment: run.environment ?? null,
    startTime: run.startTime ? run.startTime.toISOString() : null,
    endTime: run.endTime ? run.endTime.toISOString() : null,
    stats: run.stats ?? null,
  },
  sentAt: new Date().toISOString(),
});

const getNotificationDeliveryMode = (rules: unknown): NotificationDeliveryMode => {
  if (!rules || typeof rules !== "object") return "summary";
  const record = rules as Record<string, unknown>;
  const nestedRules = record.rules && typeof record.rules === "object" ? record.rules as Record<string, unknown> : null;
  const raw = typeof record.deliveryMode === "string"
    ? record.deliveryMode
    : nestedRules && typeof nestedRules.deliveryMode === "string"
      ? nestedRules.deliveryMode
      : "summary";
  return raw === "per-test" ? "per-test" : "summary";
};

const getNotificationDeliveryDelayMs = (rules: unknown): number => {
  if (!rules || typeof rules !== "object") return 0;
  const record = rules as Record<string, unknown>;
  const nestedRules = record.rules && typeof record.rules === "object" ? record.rules as Record<string, unknown> : null;
  const raw = typeof record.deliveryDelaySeconds === "number"
    ? record.deliveryDelaySeconds
    : nestedRules && typeof nestedRules.deliveryDelaySeconds === "number"
      ? nestedRules.deliveryDelaySeconds
      : 0;
  return Math.max(0, Math.floor(raw)) * 1000;
};

const getNotificationSendCompletionNotice = (rules: unknown): boolean => {
  if (!rules || typeof rules !== "object") return true;
  const record = rules as Record<string, unknown>;
  const nestedRules = record.rules && typeof record.rules === "object" ? record.rules as Record<string, unknown> : null;
  if (typeof record.sendCompletionNotice === "boolean") return record.sendCompletionNotice;
  if (nestedRules && typeof nestedRules.sendCompletionNotice === "boolean") return nestedRules.sendCompletionNotice;

  return true;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildRunSummaryChart = (stats: { broken: number; failed: number; passed: number; skipped: number; total: number }) => {
  const segments = [
    { label: "Passed", value: Math.max(0, stats.passed), color: "#16a34a" },
    { label: "Failed", value: Math.max(0, stats.failed), color: "#dc2626" },
    { label: "Broken", value: Math.max(0, stats.broken), color: "#f59e0b" },
    { label: "Skipped", value: Math.max(0, stats.skipped), color: "#6b7280" },
  ].filter((segment) => segment.value > 0);

  const width = 240;
  const height = 240;
  const cx = 120;
  const cy = 120;
  const radius = 84;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || Math.max(1, stats.total);

  let offset = 0;
  const arcs = segments.map((segment) => {
    const length = (segment.value / total) * circumference;
    const arc = `
      <circle
        cx="${cx}"
        cy="${cy}"
        r="${radius}"
        fill="none"
        stroke="${segment.color}"
        stroke-linecap="round"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${length} ${circumference - length}"
        stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${cx} ${cy})"
      />
    `;
    offset += length;
    return arc;
  }).join("\n");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Test run donut chart">
      <rect width="100%" height="100%" rx="24" fill="#ffffff" />
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="${strokeWidth}" />
      ${arcs}
      <circle cx="${cx}" cy="${cy}" r="42" fill="#ffffff" />
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="26" font-weight="700" fill="#111827">${stats.total}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="#6b7280">tests</text>
      <text x="24" y="214" font-size="11" fill="#374151">Passed ${stats.passed} Ã‚Â· Failed ${stats.failed} Ã‚Â· Broken ${stats.broken} Ã‚Â· Skipped ${stats.skipped}</text>
    </svg>
  `.trim();

  return {
    kind: "donut",
    mimeType: "image/svg+xml",
    svg,
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  };
};

// Enterprise Knowledge Base implementation lives in enterprise-staging/ai/kb-service.ts.
// Core interacts with it exclusively through ExtensionKbProxy.

export class ChatNativeService {
  constructor(
    private readonly convRepo: Repository<ChatConversation>,
    private readonly msgRepo: Repository<ChatMessage>,
  ) {}

  async listConversations(userId: number): Promise<ChatConversation[]> {
    return this.convRepo.find({
      where: { userId },
      order: { updatedAt: "DESC" },
    });
  }

  async createConversation(userId: number, projectId?: number): Promise<ChatConversation> {
    const conv = this.convRepo.create({ userId, projectId: projectId ?? null, title: "New Chat" });
    return this.convRepo.save(conv);
  }

  async getConversation(id: number, userId: number): Promise<ChatConversation | null> {
    return this.convRepo.findOne({
      where: { id, userId },
      relations: ["messages"],
      order: { messages: { createdAt: "ASC" } } as any,
    });
  }

  async deleteConversation(id: number, userId: number): Promise<void> {
    const conv = await this.convRepo.findOne({ where: { id, userId } });
    if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    await this.convRepo.remove(conv);
  }

  async updateTitle(id: number, userId: number, title: string): Promise<ChatConversation> {
    const conv = await this.convRepo.findOne({ where: { id, userId } });
    if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    conv.title = title;
    return this.convRepo.save(conv);
  }

  async addMessage(conversationId: number, userId: number, role: string, content: string): Promise<ChatMessage> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, userId } });
    if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    const msg = this.msgRepo.create({ conversationId, role, content });
    const saved = await this.msgRepo.save(msg);
    conv.updatedAt = new Date();
    await this.convRepo.save(conv);
    return saved;
  }

  async getMessages(conversationId: number, userId: number): Promise<ChatMessage[]> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, userId } });

    if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    return this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
    });
  }

  async deleteMessage(messageId: number, userId: number): Promise<void> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found");
    const conv = await this.convRepo.findOne({ where: { id: msg.conversationId, userId } });
    if (!conv) throw new HttpError(403, "FORBIDDEN", "Access denied");
    await this.msgRepo.remove(msg);
  }

  async validateStreamAccess(conversationId: number, userId: number): Promise<ChatConversation> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, userId } });
    if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    return conv;
  }

  async *streamMessage(
    conversationId: number,
    userId: number,
    content: string,
    llm: LlmServicePort,
  ): AsyncGenerator<
    { type: "chunk"; content: string } | { type: "done"; message: ChatMessage } | { type: "error"; message: string }
  > {
    const conv = await this.validateStreamAccess(conversationId, userId);

    const userMessage = this.msgRepo.create({ conversationId, role: "user", content });
    await this.msgRepo.save(userMessage);

    const history = await this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
      take: 20,
    });
    const llmMessages: LlmChatMessage[] = [
      {
        role: "system",
        content:
          "You are an engineering assistant helping review test failures and code. Answer concisely; show small code snippets only when they help.",
      },
      ...history.map((m) => ({
        role: (m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user") as LlmChatMessage["role"],
        content: m.content,
      })),
    ];

    let fullContent = "";
    try {
      for await (const chunk of llm.chatStream(llmMessages, { maxTokens: 1024 })) {
        fullContent += chunk;
        yield { type: "chunk", content: chunk };
      }
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : String(error) };
      return;
    }

    const assistantMessage = this.msgRepo.create({
      conversationId,
      role: "assistant",
      content: fullContent,
    });
    const saved = await this.msgRepo.save(assistantMessage);
    conv.updatedAt = new Date();
    await this.convRepo.save(conv);

    yield { type: "done", message: saved };
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AiResultsNativeService Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AI Edition (license activation, capabilities) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export interface AiFailureAnalysisRequest {
  runId?: number;
  resultId?: string;
  allureId?: string;
  failureMessage?: string;
  failureTimestamp?: string;
  includeConnectors?: boolean;
  includeHistory?: boolean;
  includeLogs?: boolean;
  includeTrace?: boolean;
  repositoryIds?: string[];
  stackTrace?: string;
  testName?: string;
  topK?: number;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AppServices Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type AppServices = {
  config: AppConfig;
  dataSource: DataSource;
  auth: AuthService;
  profile: ProfileService;
  projects: LegacyProjectsService;
  projectAccess: LegacyProjectAccessService;
  runs: RunsService;
  dashboard: DashboardService;
  testResultsQuery: LegacyTestResultsQueryService;

  minio: MinioStorageService;
  allureImport: LegacyAllureImportService;
  uploadOrchestration: LegacyUploadOrchestrationService;
  settings: SimpleSettingsService;
  users: UsersNativeService;
  notifications: NotificationsNativeService;
  kb: KbPort;
  chat: ChatNativeService;
  aiChat: AiChatPort;
  aiResults: AiResultsPort;
  aiEdition: AiEditionNativeService;
  entitlements: EntitlementService;
  extensionServices: ExtensionServiceRegistry;
  llm: LlmServicePort;
  aiFailureAnalysis: AiFailureAnalysisPort;
  coverage: CoveragePort;
  reruns: RerunsService;
  indexing: IndexingPort;
  mcp: McpService;
  platformUpdate: PlatformUpdateService;
};

export const createServices = async (config: AppConfig, dataSource: DataSource): Promise<AppServices> => {
  const userRepository = dataSource.getRepository(User);
  const apiKeyRepository = dataSource.getRepository(ApiKey);
  const projectRepository = dataSource.getRepository(Project);
  const membershipRepository = dataSource.getRepository(ProjectMembership);
  const testRunRepository = dataSource.getRepository(TestRun);
  const testResultRepository = dataSource.getRepository(TestResult);
  const testStepRepository = dataSource.getRepository(TestStep);
  const testAttachmentRepository = dataSource.getRepository(TestAttachment);
  const settingsRepository = dataSource.getRepository(Settings);

  const projects = new LegacyProjectsService(projectRepository as any, dataSource as any);
  const projectAccess = new LegacyProjectAccessService(
    membershipRepository as any,
    userRepository as any,
    projectRepository as any,
    projects as any,
  );
  const minio = new MinioStorageService(config);
  await minio.initialize();

  const allureImport = new LegacyAllureImportService(
    testResultRepository as any,
    testStepRepository as any,
    testAttachmentRepository as any,
    testRunRepository as any,
    dataSource as any,
    minio as any,
  );

  const notificationDeliveryRepository = dataSource.getRepository(NotificationDelivery);
  const chatConversationRepository = dataSource.getRepository(ChatConversation);
  const chatMessageRepository = dataSource.getRepository(ChatMessage);

  const settingsSvc = new SimpleSettingsService(settingsRepository);
  const installationIdentity = new InstallationIdentityService(settingsSvc);
  const aiEditionSvc = new AiEditionNativeService(settingsSvc, installationIdentity);
  const entitlementSvc = new EntitlementService(installationIdentity, settingsSvc);
  const extensionServices = new ExtensionServiceRegistry();
  const llmSvc = new ExtensionLlmProxy(extensionServices);
  const aiFailureAnalysis = new ExtensionAiFailureAnalysisProxy(extensionServices);
  const aiResults = new ExtensionAiResultsProxy(extensionServices);
  const aiChat = new ExtensionAiChatProxy(extensionServices);
  const indexingSvc = new ExtensionIndexingProxy(extensionServices);
  const kbSvc = new ExtensionKbProxy(extensionServices);
  const mcpSvc = new McpService(indexingSvc, llmSvc);
  const notificationsSvc = new NotificationsNativeService(notificationDeliveryRepository, testResultRepository, settingsSvc, config.outboundAllowedHosts);

  return {
    config,
    dataSource,
    auth: new AuthService(userRepository, apiKeyRepository, config),
    profile: new ProfileService(apiKeyRepository, userRepository),
    projects,
    projectAccess,
    runs: new RunsService(testRunRepository, testResultRepository, projects, notificationsSvc),
    dashboard: new DashboardService(new SettingsStore(settingsRepository), dataSource),
    testResultsQuery: new LegacyTestResultsQueryService(dataSource as any),
    minio,
    allureImport,
    uploadOrchestration: new LegacyUploadOrchestrationService(allureImport as any),
    settings: settingsSvc,
    users: new UsersNativeService(userRepository),
    notifications: notificationsSvc,
    kb: kbSvc,
    chat: new ChatNativeService(chatConversationRepository, chatMessageRepository),
    aiChat,
    aiResults,
    aiEdition: aiEditionSvc,
    entitlements: entitlementSvc,
    extensionServices,
    llm: llmSvc,
    aiFailureAnalysis,
    coverage: new ExtensionCoverageProxy(extensionServices),
    reruns: new RerunsService(
      dataSource.getRepository(TestRerunJob),
      dataSource.getRepository(TestRerunJobItem),
      testRunRepository,
      settingsSvc,
      projects,
      config.outboundAllowedHosts,
    ),
    indexing: indexingSvc,
    mcp: mcpSvc,
    platformUpdate: new PlatformUpdateService(config),
  };
};

export const requireProjectRole = async (
  services: AppServices,
  user: AuthUser,
  projectId: string,
  requiredRoles: ProjectRole[] = ["viewer", "maintainer", "owner"],
): Promise<string> => {
  const resolvedProjectId = await services.projects.resolveProjectId(projectId);
  const hasAccess = await services.projectAccess.hasProjectAccess(user.sub, resolvedProjectId, requiredRoles);
  if (!hasAccess) {
    throw new HttpError(403, "PROJECT_FORBIDDEN", "Project access denied");
  }

  return resolvedProjectId;
};

export const createTraceToken = (config: AppConfig, runId: number, attachmentId: string, projectId: string, userId: string): string => {
  const payload = {
    runId,
    attachmentId,
    projectId,
    userId,
    exp: Math.floor(Date.now() / 1000) + config.traceTokenTtlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", config.traceTokenSecret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
};

export const parseTraceToken = (
  config: AppConfig,
  token: string,
): { runId: number; attachmentId: string; projectId: string; userId: string; exp: number } | null => {
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = createHmac("sha256", config.traceTokenSecret)
      .update(encodedPayload)
      .digest("base64url");

    if (signature.length !== expectedSignature.length) {
      return null;
    }

    const valid = timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    if (!valid) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      runId: number;
      attachmentId: string;
      projectId: string;
      userId: string;
      exp: number;
    };

    if (payload.exp < Math.floor(Date.now() / 1000) || !payload.projectId || !payload.userId) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};
