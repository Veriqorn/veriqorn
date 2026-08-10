import { resolve } from "path";

import type { AppConfig } from "../src/config";
import type { AuthUser } from "../src/http";
import type { AppServices } from "../src/services";
import { createApp } from "../src/app";
import { ExtensionServiceRegistry } from "../src/extension-service-registry";

export const defaultAuthUser: AuthUser = {
  sub: "1",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
};

type MockRun = {
  branch?: string | null;
  endTime?: Date | null;
  environment?: string | null;
  id: number | string;
  name: string;
  projectId?: string | null;
  startTime?: Date | null;
  stats: {
    broken: number;
    failed: number;
    passRate: number;
    passed: number;
    skipped: number;
    total: number;
  };
  status: string;
  tags: string[];
  uuid?: string | null;
};

type TestAuthOverrides = {
  login?: AppServices["auth"]["login"];
  revoke?: AppServices["auth"]["revoke"];
  verify?: AppServices["auth"]["verify"];
};

type TestAppOptions = {
  auth?: TestAuthOverrides;
  config?: Partial<AppConfig>;
  services?: Partial<AppServices>;
};

export const createTestConfig = (overrides: Partial<AppConfig> = {}): AppConfig => {
  const workspaceRoot = overrides.workspaceRoot ?? "C:/test-workspace";
  return {
  port: 3001,
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/test_ops",
  jwtSecret: "test-secret",
  jwtIssuer: "veriqorn-platform",
  jwtAudience: "veriqorn-api",
  corsOrigins: ["http://localhost:3000"],
  cookieDomain: undefined,
  secureCookies: false,
  trustProxy: false,
  workspaceRoot,
  importRoot: overrides.importRoot ?? workspaceRoot,
  localRepositoryRoots: overrides.localRepositoryRoots ?? [workspaceRoot],
  outboundAllowedHosts: overrides.outboundAllowedHosts ?? ["example.com"],
  backendPublicDir: "C:/test-workspace/backend/public",
  uploadsDir: "C:/test-workspace/backend/uploads",
  migrationsGlob: "C:/test-workspace/backend/migrations/*{.ts,.js}",
  minioEnabled: false,
  minioEndpoint: "localhost",
  minioPort: 9000,
  minioUseSsl: false,
  minioAccessKey: "",
  minioSecretKey: "",
  traceTokenSecret: "trace-secret",
  traceTokenTtlSeconds: 300,
  bootstrapEmptyDatabase: true,
  runMigrations: false,
  platformVersion: "test",
  updateAgentUrl: undefined,
  updateAgentToken: undefined,
  databaseSsl: false,
  ...overrides,
  };
};

export const createMockRun = (overrides: Partial<MockRun> = {}): MockRun => ({
  branch: "main",
  endTime: new Date("2026-04-19T12:05:00.000Z"),
  environment: "ci",
  id: 101,
  name: "Smoke Run",
  projectId: "default",
  startTime: new Date("2026-04-19T12:00:00.000Z"),
  stats: {
    broken: 0,
    failed: 1,
    passRate: 66.67,
    passed: 2,
    skipped: 0,
    total: 3,
  },
  status: "completed",
  tags: ["smoke"],
  uuid: "run-101",
  ...overrides,
});

export const createProjectScopedServices = (
  overrides: Partial<AppServices> = {},
  resolvedProjectId = "default",
): Partial<AppServices> => ({
  projectAccess: {
    hasProjectAccess: async () => true,
    ...(overrides.projectAccess as object | undefined),
  } as unknown as AppServices["projectAccess"],
  projects: {
    resolveProjectId: async () => resolvedProjectId,
    ...(overrides.projects as object | undefined),
  } as unknown as AppServices["projects"],
  ...overrides,
});

const createTestAuthService = (overrides: TestAuthOverrides = {}): AppServices["auth"] =>
  ({
    login:
      overrides.login ??
      (async () => ({
        accessToken: "test-access-token",
        user: defaultAuthUser,
      })),
    verify: overrides.verify ?? (async () => defaultAuthUser),
    revoke: overrides.revoke ?? (async () => undefined),
  }) as AppServices["auth"];

export const createTestServices = (options: TestAppOptions = {}): AppServices => {
  const config = createTestConfig(options.config);

  // Route registration closes over the services object, so tests can provide
  // only the methods they exercise and grow this harness incrementally.
  return {
    config,
    auth: createTestAuthService(options.auth),
    indexing: {
      resolveLocalRepositoryPath: (pathValue: string) => resolve(process.cwd(), "..", pathValue),
    } as unknown as AppServices["indexing"],
    entitlements: {
      assert: async () => undefined,
    } as unknown as AppServices["entitlements"],
    extensionServices: new ExtensionServiceRegistry(),
    ...options.services,
  } as AppServices;
};

export const createTestApp = (options: TestAppOptions = {}) => {
  const services = createTestServices(options);
  return createApp(services.config, services);
};
