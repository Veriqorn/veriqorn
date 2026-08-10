import { describe, expect, it } from "bun:test";

import { RerunsService } from "../src/domain/reruns";
import type { TestRun } from "../src/entities/test-run.entity";

describe("backend rerun service regressions", () => {
  it("loads execution profiles from the legacy-compatible testRerunProfiles key", async () => {
    const parentRun = { id: 77, projectId: "resolved-project" } as TestRun;
    let requestedSettingsKey = "";
    let savedJob: any;

    const service = new RerunsService(
      {
        create: (fields: Record<string, unknown>) => ({ id: "job-1", items: [], ...fields }),
        findOne: async () => ({ ...savedJob, items: [] }),
        save: async (job: any) => {
          savedJob = { ...savedJob, ...job };
          return savedJob;
        },
      } as any,
      {
        create: (fields: Record<string, unknown>) => ({ id: "item-1", ...fields }),
        save: async () => undefined,
      } as any,
      {
        createQueryBuilder: () => ({
          where: () => ({
            andWhere: () => ({
              getOne: async () => parentRun,
            }),
          }),
        }),
      } as any,
      {
        get: async (key: string, projectId?: string) => {
          requestedSettingsKey = `${key}:${projectId ?? ""}`;
          return JSON.stringify({
            activeProfileId: "profile-playwright",
            profiles: [
              {
                id: "profile-playwright",
                name: "Playwright CI",
                framework: "playwright",
                executionMode: "ci-webhook",
                triggerMode: "tests_only",
                commandTemplate: "bun test {{selectorExpression}}",
                enabled: true,
              },
            ],
          });
        },
        set: async () => undefined,
      },
      {
        resolveProjectId: async () => "resolved-project",
      },
    );

    const response = await service.createJob({
      parentRunId: 77,
      projectId: "default",
      requestedByUserId: "user-1",
      body: {
        selectors: [{ kind: "testName", value: "checkout.spec.ts", testResultId: "result-1" }],
      },
    });

    expect(requestedSettingsKey).toBe("testRerunProfiles:resolved-project");
    expect(savedJob).toMatchObject({
      executionProfileId: "profile-playwright",
      framework: "playwright",
      triggerMode: "tests_only",
    });
    expect(response).toMatchObject({
      jobId: "job-1",
      framework: "playwright",
      status: "queued",
    });
  });
});
