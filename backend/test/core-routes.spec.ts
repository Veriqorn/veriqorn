import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "url";
import path from "path";

import type { AppServices } from "../src/services";
import {
  createMockRun,
  createProjectScopedServices,
  createTestApp,
  createTestConfig,
  defaultAuthUser,
} from "./test-helpers";

const authHeaders = (headers: Record<string, string> = {}) => ({
  Authorization: "Bearer test-token",
  Origin: "http://localhost:3000",
  ...headers,
});

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const allureFixtureDir = fileURLToPath(new URL("../../test-data/allure-fixtures/status-donut/", import.meta.url));
const allureFixturePath = path.relative(workspaceRoot, allureFixtureDir).split(path.sep).join("/");

describe("backend core route regressions", () => {
  it("persists and retrieves generic settings through the normalized API", async () => {
    const values = new Map<string, string>();
    const app = createTestApp({
      services: {
        settings: {
          get: async (key: string) => values.get(key) ?? null,
          set: async (key: string, value: string) => { values.set(key, value); },
        } as unknown as AppServices["settings"],
      },
    });

    const saveResponse = await app.handle(
      new Request("http://localhost/api/v1/settings/coverageEvidenceConfig", {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ value: { includeIndexedTestSources: true } }),
      }),
    );
    const readResponse = await app.handle(
      new Request("http://localhost/api/v1/settings/coverageEvidenceConfig", { headers: authHeaders() }),
    );
    const payload = await readResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(readResponse.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      data: { key: "coverageEvidenceConfig", value: { includeIndexedTestSources: true } },
    });
  });

  it("does not expose platform update status to non-admin users", async () => {
    const app = createTestApp({
      auth: { verify: async () => ({ ...defaultAuthUser, role: "user" }) },
      services: {
        platformUpdate: { getStatus: async () => ({}) } as unknown as AppServices["platformUpdate"],
      },
    });

    const response = await app.handle(new Request("http://localhost/api/v1/platform-update/status", { headers: authHeaders() }));
    expect(response.status).toBe(403);
  });

  it("returns update status only through the isolated update service", async () => {
    const app = createTestApp({
      services: {
        platformUpdate: {
          getStatus: async () => ({
            configured: true,
            currentVersion: "v1.0.0",
            latestVersion: "v1.1.0",
            updateAvailable: true,
            releaseNotesUrl: null,
            job: null,
          }),
        } as unknown as AppServices["platformUpdate"],
      },
    });

    const response = await app.handle(new Request("http://localhost/api/v1/platform-update/status", { headers: authHeaders() }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ currentVersion: "v1.0.0", updateAvailable: true });
  });

  it("keeps the root legacy auth login route as a target-stack adapter", async () => {
    const app = createTestApp();

    const response = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
          }),
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "admin123",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("x-veriqorn-canonical-route")).toBe("/api/v1/auth/session");
    expect(response.headers.get("set-cookie")).toContain("auth_token=");
    expect(payload).toMatchObject({
      success: true,
      data: {
        user: {
          email: "admin@example.com",
        },
      },
    });
  });

  it("serves the compatibility profile route with deprecation headers", async () => {
    const app = createTestApp({
      auth: {
        verify: async () => ({
          ...defaultAuthUser,
          role: "user",
          sub: "42",
        }),
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/profile", {
        headers: authHeaders(),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("x-veriqorn-canonical-route")).toBe("/me");
    expect(response.headers.get("link")).toContain("</me>; rel=\"successor-version\"");
    expect(payload).toMatchObject({
      success: true,
      data: {
        email: "admin@example.com",
        id: "42",
        name: "Admin",
        role: "user",
      },
    });
  });

  it("lists API keys for the authenticated user", async () => {
    const app = createTestApp({
      services: {
        profile: {
          listApiKeys: async (user: Parameters<AppServices["profile"]["listApiKeys"]>[0]) => [
            {
              id: "key-1",
              name: `default-${user.sub}`,
            },
          ],
        } as unknown as AppServices["profile"],
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/me/api-keys", {
        headers: authHeaders(),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      data: [{ id: "key-1", name: "default-1" }],
    });
  });

  it("forwards project list queries to the projects service", async () => {
    let capturedIncludeArchived: boolean | undefined;

    const app = createTestApp({
      services: {
        projects: {
          listProjects: async (includeArchived?: boolean) => {
            capturedIncludeArchived = includeArchived;
            return [{ id: "default", isArchived: false, name: "Default" }];
          },
        } as AppServices["projects"],
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/projects?includeArchived=true", {
        headers: authHeaders(),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(capturedIncludeArchived).toBe(true);
    expect(payload).toMatchObject({
      success: true,
      data: [{ id: "default", isArchived: false, name: "Default" }],
    });
  });

  it("normalizes dashboard metric filters and project access before invoking the service", async () => {
    let capturedArgs:
      | {
          filters: Record<string, unknown>;
          forceRefresh: boolean | undefined;
          projectId: string;
          userId: string;
        }
      | undefined;

    const app = createTestApp({
      auth: {
        verify: async () => ({
          ...defaultAuthUser,
          sub: "7",
        }),
      },
      services: createProjectScopedServices({
        dashboard: {
          getDashboardMetrics: async (userId, projectId, filters, forceRefresh) => {
            capturedArgs = { filters, forceRefresh, projectId, userId };
            return { summary: { totalRuns: 4 } };
          },
        } as AppServices["dashboard"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request(
        "http://localhost/api/v1/projects/default/dashboard-metrics?branch=main&environment=ci&status=failed&tags=smoke,fast&refresh=force",
        {
          headers: authHeaders(),
        },
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(capturedArgs).toEqual({
      filters: {
        branch: "main",
        dateFrom: undefined,
        dateTo: undefined,
        environment: "ci",
        status: "failed",
        tags: ["smoke", "fast"],
      },
      forceRefresh: true,
      projectId: "resolved-project",
      userId: "7",
    });
    expect(payload).toMatchObject({
      success: true,
      data: {
        summary: {
          totalRuns: 4,
        },
      },
    });
  });

  it("returns the normalized runs list and forwards list filters", async () => {
    let capturedOptions: Record<string, unknown> | undefined;

    const app = createTestApp({
      services: createProjectScopedServices({
        runs: {
          getTestRuns: async (options) => {
            capturedOptions = options as Record<string, unknown>;
            return {
              items: [createMockRun({ id: 205, name: "Failure Run", status: "failed" })],
              limit: 10,
              page: 2,
              total: 1,
            };
          },
        } as AppServices["runs"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request(
        "http://localhost/api/v1/projects/default/runs?page=2&limit=10&status=failed&search=checkout&sortBy=startTime&sortOrder=asc",
        {
          headers: authHeaders(),
        },
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(capturedOptions).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
      limit: 10,
      page: 2,
      projectId: "resolved-project",
      search: "checkout",
      sortBy: "startTime",
      sortOrder: "asc",
      status: "failed",
    });
    expect(payload).toMatchObject({
      success: true,
      data: {
        items: [{ id: 205, name: "Failure Run", status: "failed" }],
        limit: 10,
        page: 2,
        total: 1,
      },
    });
  });

  it("keeps the root legacy test-results run route as a project-scoped adapter", async () => {
    let capturedRunLookup: { projectId: string | undefined; runId: number | string } | undefined;
    let capturedResultsRunId: number | undefined;

    const app = createTestApp({
      services: createProjectScopedServices({
        runs: {
          getTestRun: async (
            runId: Parameters<AppServices["runs"]["getTestRun"]>[0],
            projectId: Parameters<AppServices["runs"]["getTestRun"]>[1],
          ) => {
            capturedRunLookup = { projectId, runId };
            return createMockRun({ id: Number(runId), projectId });
          },
        } as unknown as AppServices["runs"],
        testResultsQuery: {
          getResultsForRun: async (runId: number) => {
            capturedResultsRunId = runId;
            return { results: [] };
          },
        } as unknown as AppServices["testResultsQuery"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request("http://localhost/test-results/run/205?projectId=default", {
        headers: authHeaders(),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("x-veriqorn-canonical-route")).toBe("/api/v1/projects/:projectId/runs/:runId/results");
    expect(capturedRunLookup).toEqual({ projectId: "resolved-project", runId: "205" });
    expect(capturedResultsRunId).toBe(205);
    expect(payload).toMatchObject({
      success: true,
      data: {
        results: [],
      },
    });
  });

  it("does not expose Enterprise connector or repository diagnostics in Community mode", async () => {
    const app = createTestApp();
    const connectorResponse = await app.handle(
      new Request("http://localhost/api/v1/ai/connectors/types", {
        headers: authHeaders(),
      }),
    );
    const connectorPayload = await connectorResponse.json();

    const repositoryResponse = await app.handle(
      new Request("http://localhost/api/v1/ai/repositories/test-connections", {
        method: "POST",
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
          }),
        },
        body: JSON.stringify({ localPath: allureFixturePath }),
      }),
    );
    const repositoryPayload = await repositoryResponse.json();

    expect(connectorResponse.status).toBe(404);
    expect(connectorPayload).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(repositoryResponse.status).toBe(404);
    expect(repositoryPayload).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("imports allure results from a directory path through the normalized route", async () => {
    let capturedDiagnosticsKey: string | undefined;
    let capturedImportPayload: Record<string, unknown> | undefined;
    let createdRunInput: { body: Record<string, unknown>; projectId: string | undefined } | undefined;
    let completedRun: { projectId: string | undefined; runId: number | string } | undefined;

    const finishedRun = createMockRun({
      id: 501,
      name: "Directory Import",
      projectId: "resolved-project",
      tags: ["smoke", "ci"],
    });

    const app = createTestApp({
      config: createTestConfig({
        workspaceRoot,
      }),
      services: createProjectScopedServices({
        runs: {
          completeTestRun: async (
            runId: Parameters<AppServices["runs"]["completeTestRun"]>[0],
            projectId: Parameters<AppServices["runs"]["completeTestRun"]>[1],
          ) => {
            completedRun = { projectId, runId };
            return finishedRun;
          },
          createTestRun: async (
            body: Parameters<AppServices["runs"]["createTestRun"]>[0],
            projectId: Parameters<AppServices["runs"]["createTestRun"]>[1],
          ) => {
            createdRunInput = { body: body as Record<string, unknown>, projectId };
            return createMockRun({
              id: 501,
              name: "Directory Import",
              projectId,
              status: "running",
              endTime: null,
            });
          },
        } as unknown as AppServices["runs"],
        uploadOrchestration: {
          createDiagnostics: (key: string) => {
            capturedDiagnosticsKey = key;
            return { key };
          },
          importFromDirectory: async (
            payload: Parameters<AppServices["uploadOrchestration"]["importFromDirectory"]>[0],
          ) => {
            capturedImportPayload = payload as unknown as Record<string, unknown>;
          },
        } as unknown as AppServices["uploadOrchestration"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/projects/default/imports/allure-jobs", {
        method: "POST",
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
          }),
        },
        body: JSON.stringify({
          run: {
            branch: "main",
            environment: "ci",
            runName: "Directory Import",
            tags: ["smoke", "ci"],
          },
          source: {
            directoryPath: allureFixturePath,
            kind: "directory_path",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(createdRunInput).toEqual({
      body: {
        branch: "main",
        environment: "ci",
        name: "Directory Import [main]",
        tags: ["smoke", "ci"],
      },
      projectId: "resolved-project",
    });
    expect(capturedDiagnosticsKey).toBe("backend/imports/allure-jobs/directory-path");
    expect(capturedImportPayload).toMatchObject({
      directoryPath: path.resolve(workspaceRoot, allureFixturePath),
      source: "path",
      testRunId: 501,
    });
    expect(completedRun).toEqual({
      projectId: "resolved-project",
      runId: 501,
    });
    expect(payload).toMatchObject({
      success: true,
      data: {
        job: {
          merged: false,
          sourceKind: "directory_path",
          status: "completed",
        },
        message: "Test results imported successfully",
        testRun: {
          id: 501,
          name: "Directory Import",
          projectId: "resolved-project",
        },
      },
    });
  });

  it("marks newly created import runs as failed when the import pipeline fails", async () => {
    let failedRun: { projectId: string | undefined; runId: number | string } | undefined;
    let completedRunCalled = false;

    const app = createTestApp({
      config: createTestConfig({
        workspaceRoot,
      }),
      services: createProjectScopedServices({
        runs: {
          completeTestRun: async () => {
            completedRunCalled = true;
            return createMockRun({ id: 504 });
          },
          createTestRun: async () =>
            createMockRun({
              id: 504,
              name: "Broken Import",
              projectId: "resolved-project",
              status: "running",
              endTime: null,
            }),
          failTestRun: async (
            runId: Parameters<AppServices["runs"]["failTestRun"]>[0],
            projectId: Parameters<AppServices["runs"]["failTestRun"]>[1],
          ) => {
            failedRun = { projectId, runId };
            return createMockRun({
              id: Number(runId),
              name: "Broken Import",
              projectId,
              status: "failed",
            });
          },
        } as unknown as AppServices["runs"],
        uploadOrchestration: {
          createDiagnostics: (key: string) => ({ key }),
          importFromDirectory: async () => {
            throw new Error("invalid allure payload");
          },
        } as unknown as AppServices["uploadOrchestration"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/projects/default/imports/allure-jobs", {
        method: "POST",
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
          }),
        },
        body: JSON.stringify({
          run: {
            runName: "Broken Import",
          },
          source: {
            directoryPath: allureFixturePath,
            kind: "directory_path",
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(completedRunCalled).toBe(false);
    expect(failedRun).toEqual({
      projectId: "resolved-project",
      runId: 504,
    });
    expect(payload).toMatchObject({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "invalid allure payload",
      },
    });
  });

  it("keeps the legacy path import adapter live with deprecation headers", async () => {
    let capturedDiagnosticsKey: string | undefined;

    const app = createTestApp({
      config: createTestConfig({
        workspaceRoot,
      }),
      services: createProjectScopedServices({
        runs: {
          completeTestRun: async () =>
            createMockRun({
              id: 502,
              name: "Legacy Path Import",
              projectId: "resolved-project",
            }),
          createTestRun: async () =>
            createMockRun({
              id: 502,
              name: "Legacy Path Import",
              projectId: "resolved-project",
              status: "running",
              endTime: null,
            }),
        } as unknown as AppServices["runs"],
        uploadOrchestration: {
          createDiagnostics: (key: string) => {
            capturedDiagnosticsKey = key;
            return { key };
          },
          importFromDirectory: async () => undefined,
        } as unknown as AppServices["uploadOrchestration"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/projects/default/imports/allure/path", {
        method: "POST",
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
          }),
        },
        body: JSON.stringify({
          directoryPath: allureFixturePath,
          runName: "Legacy Path Import",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("x-veriqorn-canonical-route")).toBe("/:projectId/imports/allure-jobs");
    expect(capturedDiagnosticsKey).toBe("backend/imports/path");
    expect(payload).toMatchObject({
      success: true,
      data: {
        job: {
          merged: false,
          sourceKind: "directory_path",
          status: "completed",
        },
        message: "Test results imported successfully",
      },
    });
  });

  it("keeps the root legacy upload-from-path route as a target-stack import adapter", async () => {
    let capturedDiagnosticsKey: string | undefined;
    let capturedImportPayload: Record<string, unknown> | undefined;

    const app = createTestApp({
      config: createTestConfig({
        workspaceRoot,
      }),
      services: createProjectScopedServices({
        runs: {
          completeTestRun: async () =>
            createMockRun({
              id: 503,
              name: "Root Legacy Import",
              projectId: "resolved-project",
            }),
          createTestRun: async () =>
            createMockRun({
              id: 503,
              name: "Root Legacy Import",
              projectId: "resolved-project",
              status: "running",
              endTime: null,
            }),
        } as unknown as AppServices["runs"],
        uploadOrchestration: {
          createDiagnostics: (key: string) => {
            capturedDiagnosticsKey = key;
            return { key };
          },
          importFromDirectory: async (
            payload: Parameters<AppServices["uploadOrchestration"]["importFromDirectory"]>[0],
          ) => {
            capturedImportPayload = payload as unknown as Record<string, unknown>;
          },
        } as unknown as AppServices["uploadOrchestration"],
      }, "resolved-project"),
    });

    const response = await app.handle(
      new Request("http://localhost/upload/allure-results-from-path", {
        method: "POST",
        headers: {
          ...authHeaders({
            "Content-Type": "application/json",
          }),
        },
        body: JSON.stringify({
          directoryPath: allureFixturePath,
          projectId: "default",
          runName: "Root Legacy Import",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("x-veriqorn-canonical-route")).toBe("/api/v1/projects/:projectId/imports/allure-jobs");
    expect(capturedDiagnosticsKey).toBe("backend/legacy-root/upload-from-path");
    expect(capturedImportPayload).toMatchObject({
      directoryPath: path.resolve(workspaceRoot, allureFixturePath),
      source: "from-path",
      testRunId: 503,
    });
    expect(payload).toMatchObject({
      success: true,
      data: {
        job: {
          sourceKind: "directory_path",
          status: "completed",
        },
      },
    });
  });
});
