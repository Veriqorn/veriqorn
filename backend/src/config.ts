import "reflect-metadata";

import { resolve } from "path";
import { existsSync } from "fs";
import { config as loadDotEnv } from "dotenv";
import { DataSource } from "typeorm";

import type { LoadedBackendExtension } from "./extensions";

import { User } from "./entities/user.entity";
import { Project } from "./entities/project.entity";
import { ProjectMembership } from "./entities/project-membership.entity";
import { TestRun } from "./entities/test-run.entity";
import { TestResult } from "./entities/test-result.entity";
import { TestStep } from "./entities/test-step.entity";
import { TestAttachment } from "./entities/test-attachment.entity";
import { TestStepAttachment } from "./entities/test-step-attachment.entity";
import { TestArtifact } from "./entities/test-artifact.entity";
import { Settings } from "./entities/settings.entity";
import { ApiKey } from "./entities/api-key.entity";
import { NotificationDelivery } from "./entities/notification-delivery.entity";
import { ChatConversation } from "./entities/chat-conversation.entity";
import { ChatMessage } from "./entities/chat-message.entity";
import { TestRerunJob } from "./entities/test-rerun-job.entity";
import { TestRerunJobItem } from "./entities/test-rerun-job-item.entity";

export type AppConfig = {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  corsOrigins: string[];
  cookieDomain?: string;
  secureCookies: boolean;
  trustProxy: boolean;
  workspaceRoot: string;
  importRoot: string;
  localRepositoryRoots: string[];
  outboundAllowedHosts: string[];
  backendPublicDir: string;
  uploadsDir: string;
  migrationsGlob: string;
  minioEnabled: boolean;
  minioEndpoint: string;
  minioPort: number;
  minioUseSsl: boolean;
  minioAccessKey: string;
  minioSecretKey: string;
  traceTokenSecret: string;
  traceTokenTtlSeconds: number;
  bootstrapEmptyDatabase: boolean;
  bootstrapAdminEmail?: string;
  bootstrapAdminPassword?: string;
  runMigrations: boolean;
  platformVersion: string;
  updateAgentUrl?: string;
  updateAgentToken?: string;
  databaseSsl: boolean;
  extensionsManifestPath?: string;
  extensionsRoot?: string;
};

const entities = [
  User,
  Project,
  ProjectMembership,
  TestRun,
  TestResult,
  TestStep,
  TestAttachment,
  TestStepAttachment,
  TestArtifact,
  Settings,
  ApiKey,
  NotificationDelivery,
  ChatConversation,
  ChatMessage,
  TestRerunJob,
  TestRerunJobItem,
];

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

export const validateInstallationIdentityEncryption = (environment: Record<string, string | undefined> = process.env): void => {
  const required = parseBoolean(environment.VERIQORN_REQUIRE_ENCRYPTED_INSTALLATION_IDENTITY, false);
  const rawKey = environment.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY?.trim();
  if (required && !rawKey) {
    throw new Error("VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY is required when VERIQORN_REQUIRE_ENCRYPTED_INSTALLATION_IDENTITY is enabled");
  }
  if (!rawKey) return;
  if (Buffer.from(rawKey, "base64url").length !== 32) {
    throw new Error("VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY must be a 32-byte base64url value");
  }
};

const assertBootstrapCredentials = (email: string | undefined, password: string | undefined): void => {
  if (Boolean(email) !== Boolean(password)) {
    throw new Error("BACKEND_BOOTSTRAP_ADMIN_EMAIL and BACKEND_BOOTSTRAP_ADMIN_PASSWORD must be provided together");
  }
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("BACKEND_BOOTSTRAP_ADMIN_EMAIL must be a valid email address");
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password ?? "")).length;
  if ((password?.length ?? 0) < 12 || (password?.length ?? 0) > 128 || classes < 3) {
    throw new Error("BACKEND_BOOTSTRAP_ADMIN_PASSWORD must be 12-128 characters and contain at least three character classes");
  }
};

const resolveSecureCookies = (corsOrigins: string[]): boolean => {
  const override = process.env.BACKEND_SECURE_COOKIES?.trim();
  if (override) {
    return parseBoolean(override, true);
  }

  const originCandidates = [
    process.env.FRONTEND_URL?.trim(),
    ...corsOrigins,
  ].filter((origin): origin is string => Boolean(origin));

  if (originCandidates.length === 0) {
    return process.env.NODE_ENV === "production";
  }

  return originCandidates.some((origin) =>
    origin.toLowerCase().startsWith("https://"),
  );
};

export const resolveMigrationsGlob = (
  projectRoot: string,
  explicitDir = process.env.BACKEND_MIGRATIONS_DIR?.trim(),
): string => {
  const candidateDirs = [
    explicitDir ? resolve(projectRoot, explicitDir) : undefined,
    resolve(projectRoot, "migrations"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const migrationsDir =
    candidateDirs.find((candidate) => existsSync(candidate)) ??
    candidateDirs[0] ??
    resolve(projectRoot, "migrations");

  return resolve(migrationsDir, "*{.ts,.js}");
};

export const loadConfig = (): AppConfig => {
  const projectRoot = resolve(import.meta.dir, "..");
  const workspaceRoot = resolve(projectRoot, "..");
  const defaultExtensionsManifestPath = resolve(projectRoot, "extensions", "manifest.json");
  const envFiles = [resolve(projectRoot, ".env")];

  for (const envFile of envFiles) {
    if (existsSync(envFile)) {
      loadDotEnv({ path: envFile, override: false });
    }
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required for backend");
  }

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error("JWT_SECRET environment variable is required for backend");
  }
  if (process.env.NODE_ENV === "production" && (
    jwtSecret.length < 32 ||
    ["veriqorn-local-jwt-secret", "your-super-secret-jwt-key-here"].includes(jwtSecret)
  )) {
    throw new Error("JWT_SECRET must be a unique value of at least 32 characters in production");
  }

  const traceTokenSecret = process.env.TRACE_TOKEN_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (!traceTokenSecret || traceTokenSecret === jwtSecret || traceTokenSecret.length < 32)) {
    throw new Error("TRACE_TOKEN_SECRET must be a distinct value of at least 32 characters in production");
  }
  validateInstallationIdentityEncryption();

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : ["http://localhost:3000"];
  const bootstrapAdminEmail = process.env.BACKEND_BOOTSTRAP_ADMIN_EMAIL?.trim() || undefined;
  const bootstrapAdminPassword = process.env.BACKEND_BOOTSTRAP_ADMIN_PASSWORD || undefined;
  assertBootstrapCredentials(bootstrapAdminEmail, bootstrapAdminPassword);

  return {
    port: parseNumber(process.env.PORT, 3001),
    databaseUrl,
    jwtSecret,
    jwtIssuer: process.env.JWT_ISSUER?.trim() || "veriqorn-platform",
    jwtAudience: process.env.JWT_AUDIENCE?.trim() || "veriqorn-api",
    corsOrigins,
    cookieDomain: process.env.COOKIE_DOMAIN?.trim() || undefined,
    secureCookies: resolveSecureCookies(corsOrigins),
    trustProxy: parseBoolean(process.env.BACKEND_TRUST_PROXY, false),
    workspaceRoot,
    importRoot: resolve(workspaceRoot, process.env.ALLURE_IMPORT_ROOT?.trim() || "backend/uploads"),
    localRepositoryRoots: (process.env.LOCAL_REPOSITORY_ROOTS?.split(",") ?? ["backend/src", "frontend/src", "packages/contracts/src", "kb-site/src", "test"])
      .map((entry) => resolve(workspaceRoot, entry.trim()))
      .filter(Boolean),
    outboundAllowedHosts: (process.env.OUTBOUND_ALLOWED_HOSTS?.split(",") ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    backendPublicDir: resolve(projectRoot, "public"),
    uploadsDir: resolve(projectRoot, "uploads"),
    migrationsGlob: resolveMigrationsGlob(projectRoot),
    minioEnabled: parseBoolean(process.env.MINIO_ENABLED, true),
    minioEndpoint: process.env.MINIO_ENDPOINT?.trim() || "localhost",
    minioPort: parseNumber(process.env.MINIO_PORT, 9000),
    minioUseSsl: parseBoolean(process.env.MINIO_USE_SSL, false),
    minioAccessKey: process.env.MINIO_ACCESS_KEY?.trim() || "",
    minioSecretKey: process.env.MINIO_SECRET_KEY?.trim() || "",
    traceTokenSecret: traceTokenSecret || jwtSecret,
    traceTokenTtlSeconds: parseNumber(process.env.TRACE_TOKEN_TTL_SECONDS, 300),
    bootstrapEmptyDatabase: parseBoolean(
      process.env.BACKEND_BOOTSTRAP_EMPTY_DATABASE,
      true,
    ),
    bootstrapAdminEmail,
    bootstrapAdminPassword,
    runMigrations: parseBoolean(process.env.BACKEND_RUN_MIGRATIONS, false),
    platformVersion: process.env.PLATFORM_VERSION?.trim() || "dev",
    updateAgentUrl: process.env.PLATFORM_UPDATE_AGENT_URL?.trim().replace(/\/+$/, "") || undefined,
    updateAgentToken: process.env.PLATFORM_UPDATE_AGENT_TOKEN?.trim() || undefined,
    databaseSsl: parseBoolean(process.env.DATABASE_SSL, false),
    extensionsManifestPath: process.env.VERIQORN_EXTENSIONS_MANIFEST?.trim()
      ? resolve(projectRoot, process.env.VERIQORN_EXTENSIONS_MANIFEST.trim())
      : existsSync(defaultExtensionsManifestPath)
        ? defaultExtensionsManifestPath
        : undefined,
    extensionsRoot: resolve(projectRoot, process.env.VERIQORN_EXTENSIONS_ROOT?.trim() || "extensions"),
  };
};

export const createDataSource = (
  config: AppConfig,
  extensions: ReadonlyArray<Pick<LoadedBackendExtension, "entities" | "migrations">> = [],
): DataSource => {
  const extensionEntities = extensions.flatMap((extension) => extension.entities ?? []);
  const extensionMigrations = extensions.flatMap((extension) => extension.migrations ?? []);
  return new DataSource({
    type: "postgres",
    url: config.databaseUrl,
    // Extension descriptors are validated by the explicit manifest loader
    // before reaching this composition point. TypeORM accepts entity targets
    // and migration classes at runtime; the public SDK intentionally keeps
    // these framework-specific values opaque.
    entities: [...entities, ...extensionEntities] as never,
    synchronize: false,
    migrations: [config.migrationsGlob, ...extensionMigrations] as never,
    extra: {
      client_encoding: "utf8",
    },
    ssl: config.databaseSsl ? { rejectUnauthorized: parseBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, true) } : false,
  });
};
