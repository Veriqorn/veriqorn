import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DataSource } from "typeorm";
import { resolve } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { createDataSource, resolveMigrationsGlob } from "../src/config";
import { prepareDatabase } from "../src/database";
import { ProjectMembership } from "../src/entities/project-membership.entity";
import { Project } from "../src/entities/project.entity";
import { User } from "../src/entities/user.entity";
import { createTestConfig } from "./test-helpers";
import { TestAttachment } from "../src/entities/test-attachment.entity";
import { TestRun } from "../src/entities/test-run.entity";
import { TestResult } from "../src/entities/test-result.entity";
import { TestStep } from "../src/entities/test-step.entity";
import { AllureImportService } from "../src/domain/allure-import";
import { TestResultsQueryService } from "../src/domain/test-results-query";
import { AddAttachmentStorageConnection1763800000000 } from "../migrations/1763800000000-AddAttachmentStorageConnection";
import type { MinioStorageService } from "../src/services";

// The supplied PostgreSQL account must be allowed to create/drop temporary databases.
// Existing databases and their schemas are never modified.
const databaseUrl = process.env.VERIQORN_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL dependency compatibility", () => {
  let dataSource: DataSource;
  let admin: DataSource;
  const temporaryDatabase = "veriqorn_deps_" + crypto.randomUUID().replaceAll("-", "");
  const config = createTestConfig({
    migrationsGlob: resolveMigrationsGlob(resolve(import.meta.dir, "..")),
    runMigrations: true,
  });

  beforeAll(async () => {
    admin = new DataSource({ type: "postgres", url: databaseUrl });
    await admin.initialize();
    await admin.query('CREATE DATABASE "' + temporaryDatabase + '"');
    const url = new URL(databaseUrl!);
    url.pathname = "/" + temporaryDatabase;
    config.databaseUrl = url.toString();
    dataSource = createDataSource(config);
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (admin?.isInitialized) {
      await admin.query('DROP DATABASE IF EXISTS "' + temporaryDatabase + '"');
      await admin.destroy();
    }
  });

  it("bootstraps an empty database and records the current migration baseline", async () => {
    expect(await prepareDatabase(config, dataSource)).toBe("bootstrapped");
    expect(await dataSource.getRepository(Project).count()).toBe(1);
    expect((await dataSource.query('SELECT COUNT(*)::int AS count FROM "migrations"'))[0].count).toBeGreaterThan(0);
    expect(await prepareDatabase(config, dataSource)).toBe("migrated");
  });

  it("loads membership relations through the TypeORM object syntax", async () => {
    const user = await dataSource.getRepository(User).save({
      email: "dependency-test@example.com", name: "Dependency test", password: "unused", role: "user",
    });
    await dataSource.getRepository(ProjectMembership).save({
      projectId: "default", userId: user.id, projectRole: "viewer",
    });
    const membership = await dataSource.getRepository(ProjectMembership).findOneOrFail({
      where: { userId: user.id, projectId: "default" },
      relations: { user: true, project: true },
    });
    expect(membership.user.email).toBe(user.email);
    expect(membership.project.id).toBe("default");
  });

  it("rejects undefined identifiers instead of dropping the query filter", async () => {
    await expect(dataSource.getRepository(User).findOneBy({ id: undefined })).rejects.toThrow();
  });

  it("upgrades legacy attachment references and prevents losing new references on rollback", async () => {
    const runner = dataSource.createQueryRunner();
    const migration = new AddAttachmentStorageConnection1763800000000();
    try {
      await runner.query('ALTER TABLE "test_attachment" DROP COLUMN "storageConnectionId"');
      const id = crypto.randomUUID();
      await runner.query('INSERT INTO "test_attachment" (id, name, type, source, "storageType", "storageBucket", "objectKey") VALUES ($1, $2, $3, $2, $4, $5, $6)', [id, "legacy.png", "image/png", "minio", "screenshots", "old.png"]);
      await migration.up(runner);
      const [legacy] = await runner.query('SELECT * FROM "test_attachment" WHERE id = $1', [id]);
      expect(legacy.storageConnectionId).toBeNull();
      expect(legacy.objectKey).toBe("old.png");
      await migration.down(runner);
      await migration.up(runner);
      await runner.query('UPDATE "test_attachment" SET "storageConnectionId" = $1 WHERE id = $2', [crypto.randomUUID(), id]);
      await expect(migration.down(runner)).rejects.toThrow("Migrate attachments back");
    } finally { await runner.release(); }
  });

  it("persists and reads S3 connection references through the real Allure SQL path", async () => {
    const outputRoot = resolve(import.meta.dir, "../../test/test-results");
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(resolve(outputRoot, "storage-import-"));
    const source = "database-storage-attachment.png";
    const connectionId = crypto.randomUUID();
    const content = Buffer.from("screenshot content");
    try {
      await writeFile(resolve(directory, source), content);
      await writeFile(resolve(directory, "storage-result.json"), JSON.stringify({
        uuid: crypto.randomUUID(), name: "storage integration", status: "passed", start: Date.now(), stop: Date.now(),
        steps: [{ name: "screenshot", status: "passed", attachments: [{ name: "screenshot", source, type: "image/png" }] }],
      }));
      const run = await dataSource.getRepository(TestRun).save({ name: "Storage integration" });
      const importer = new AllureImportService(
        dataSource.getRepository(TestResult), dataSource.getRepository(TestStep),
        dataSource.getRepository(TestAttachment), dataSource.getRepository(TestRun), dataSource,
        {
          isAvailable: async () => true,
          uploadBuffer: async () => ({ storageType: "s3", storageConnectionId: connectionId, storageBucket: "private-evidence", objectKey: "evidence/screenshots/capture.png" }),
          deleteFile: async () => undefined,
        } as unknown as MinioStorageService,
      );
      await importer.importFromDirectory(directory, run.id);
      const attachment = await dataSource.getRepository(TestAttachment).findOneByOrFail({ source });
      expect(attachment).toMatchObject({ content: null, storageType: "s3", storageConnectionId: connectionId, storageBucket: "private-evidence", size: content.length });
      expect(attachment.checksum).toHaveLength(64);
      const queried = await new TestResultsQueryService(dataSource).findAttachmentForRun(run.id, attachment.id);
      expect(queried?.storageConnectionId).toBe(connectionId);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
