import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import type { DataSource, Repository } from "typeorm";

import { AllureImportService } from "../src/domain/allure-import";
import type { TestAttachment } from "../src/entities/test-attachment.entity";
import type { TestResult } from "../src/entities/test-result.entity";
import type { TestRun } from "../src/entities/test-run.entity";
import type { TestStep } from "../src/entities/test-step.entity";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const testOutputRoot = join(workspaceRoot, "test", "test-results");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let tempDirs: string[] = [];

const createTempAllureDir = async () => {
  await mkdir(testOutputRoot, { recursive: true });
  const tempDir = await mkdtemp(join(testOutputRoot, "allure-import-"));
  tempDirs.push(tempDir);
  return tempDir;
};

describe("AllureImportService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs = [];
  });

  it("normalizes non-UUID Allure result identifiers before saving to the database", async () => {
    const tempDir = await createTempAllureDir();
    await writeFile(
      join(tempDir, "sample-result.json"),
      JSON.stringify({
        uuid: "single-0001",
        name: "single fixture test",
        status: "passed",
        start: 1733000000000,
        stop: 1733000001000,
      }),
      "utf8",
    );

    const savedResults: Array<Record<string, unknown>> = [];
    const service = new AllureImportService(
      {
        create: (value: Record<string, unknown>) => value,
        save: async (value: Record<string, unknown>) => {
          savedResults.push(value);
          return value;
        },
      } as unknown as Repository<TestResult>,
      {
        create: (value: Record<string, unknown>) => value,
        save: async (value: Record<string, unknown>) => value,
      } as unknown as Repository<TestStep>,
      {} as Repository<TestAttachment>,
      {
        findOne: async () => ({ id: 77 }),
      } as unknown as Repository<TestRun>,
      {
        query: async () => [],
      } as unknown as DataSource,
    );

    await service.importFromDirectory(tempDir, 77);

    expect(savedResults).toHaveLength(1);
    expect(typeof savedResults[0].uuid).toBe("string");
    expect(savedResults[0].uuid).toMatch(uuidPattern);
    expect(savedResults[0].uuid).not.toBe("single-0001");
    expect(savedResults[0].labels).toContainEqual({
      name: "allureUuid",
      value: "single-0001",
    });
  });
});
