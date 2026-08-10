import { hash } from "bcrypt";
import { DataSource, MigrationExecutor } from "typeorm";

import type { AppConfig } from "./config";
import { ProjectMembership } from "./entities/project-membership.entity";
import { Project } from "./entities/project.entity";
import { User } from "./entities/user.entity";

const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default Project";
const DEFAULT_PROJECT_KEY = "default";
const DEFAULT_PROJECT_DESCRIPTION = "System default project for legacy and shared data";

const listPublicTables = async (dataSource: DataSource): Promise<string[]> => {
  const rows = await dataSource.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `) as Array<{ table_name?: string }>;

  return rows
    .map((row) => row.table_name?.trim() || "")
    .filter(Boolean);
};

const ensureUuidExtension = async (dataSource: DataSource): Promise<void> => {
  if (dataSource.options.type !== "postgres") {
    return;
  }

  await dataSource.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
};

const baselineCurrentMigrations = async (dataSource: DataSource): Promise<void> => {
  const executor = new MigrationExecutor(dataSource);
  const executed = await executor.getExecutedMigrations();
  const executedNames = new Set(executed.map((migration) => migration.name));

  for (const migration of await executor.getAllMigrations()) {
    if (!executedNames.has(migration.name)) {
      await executor.insertMigration(migration);
    }
  }
};

const ensureBootstrapSeedData = async (dataSource: DataSource, config: AppConfig): Promise<void> => {
  const userRepository = dataSource.getRepository(User);
  const projectRepository = dataSource.getRepository(Project);
  const membershipRepository = dataSource.getRepository(ProjectMembership);

  let project = await projectRepository.findOne({
    where: { id: DEFAULT_PROJECT_ID },
  });

  if (!project) {
    project = projectRepository.create({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      key: DEFAULT_PROJECT_KEY,
      description: DEFAULT_PROJECT_DESCRIPTION,
      isArchived: false,
      isDefault: true,
    });
  } else {
    project.name = project.name || DEFAULT_PROJECT_NAME;
    project.key = project.key || DEFAULT_PROJECT_KEY;
    project.description = project.description || DEFAULT_PROJECT_DESCRIPTION;
    project.isArchived = false;
    project.isDefault = true;
  }

  project = await projectRepository.save(project);

  await projectRepository
    .createQueryBuilder()
    .update(Project)
    .set({ isDefault: false })
    .where("id <> :id", { id: project.id })
    .andWhere("isDefault = true")
    .execute();

  const existingUserCount = await userRepository.count();
  const bootstrapUsers = existingUserCount === 0 && config.bootstrapAdminEmail && config.bootstrapAdminPassword
    ? [{ email: config.bootstrapAdminEmail, name: "Administrator", password: config.bootstrapAdminPassword, projectRole: "owner" as const, role: "admin" as const }]
    : [];
  if (process.env.NODE_ENV === "production" && bootstrapUsers.length === 0 && existingUserCount === 0) {
    throw new Error("BACKEND_BOOTSTRAP_ADMIN_EMAIL and BACKEND_BOOTSTRAP_ADMIN_PASSWORD are required for an empty production database");
  }

  for (const bootstrapUser of bootstrapUsers) {
    let user = await userRepository.findOne({
      where: { email: bootstrapUser.email },
    });

    if (!user) {
      user = userRepository.create({
        email: bootstrapUser.email,
        name: bootstrapUser.name,
        password: await hash(bootstrapUser.password, 12),
        role: bootstrapUser.role,
      });
      user = await userRepository.save(user);
    }

    const membership = await membershipRepository.findOne({
      where: {
        projectId: project.id,
        userId: user.id,
      },
    });

    if (!membership) {
      await membershipRepository.save(
        membershipRepository.create({
          projectId: project.id,
          projectRole: bootstrapUser.projectRole,
          userId: user.id,
        }),
      );
    }
  }
};

export const prepareDatabase = async (
  config: AppConfig,
  dataSource: DataSource,
): Promise<"bootstrapped" | "migrated" | "ready"> => {
  await ensureUuidExtension(dataSource);

  const publicTables = await listPublicTables(dataSource);
  const appTables = publicTables.filter(
    (tableName) =>
      tableName !== "migrations" && tableName !== "typeorm_metadata",
  );

  if (appTables.length === 0 && config.bootstrapEmptyDatabase) {
    await dataSource.synchronize();
    await baselineCurrentMigrations(dataSource);
    await ensureBootstrapSeedData(dataSource, config);
    return "bootstrapped";
  }

  if (config.runMigrations) {
    const executor = new MigrationExecutor(dataSource);
    await executor.executePendingMigrations();
    await ensureBootstrapSeedData(dataSource, config);
    return "migrated";
  }

  await ensureBootstrapSeedData(dataSource, config);
  return "ready";
};
