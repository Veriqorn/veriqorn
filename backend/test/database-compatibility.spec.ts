import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DataSource } from "typeorm";
import { resolve } from "node:path";

import { createDataSource, resolveMigrationsGlob } from "../src/config";
import { prepareDatabase } from "../src/database";
import { ProjectMembership } from "../src/entities/project-membership.entity";
import { Project } from "../src/entities/project.entity";
import { User } from "../src/entities/user.entity";
import { createTestConfig } from "./test-helpers";

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
});
