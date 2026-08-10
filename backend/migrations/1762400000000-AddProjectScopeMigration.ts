import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectScopeMigration1762400000000
  implements MigrationInterface
{
  name = "AddProjectScopeMigration1762400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'project_membership_projectrole_enum'
        ) THEN
          CREATE TYPE "project_membership_projectrole_enum" AS ENUM ('owner', 'maintainer', 'viewer');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project" (
        "id" varchar(64) PRIMARY KEY,
        "name" varchar(120) NOT NULL,
        "key" varchar(120) NOT NULL UNIQUE,
        "description" text,
        "isDefault" boolean NOT NULL DEFAULT false,
        "isArchived" boolean NOT NULL DEFAULT false,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_membership" (
        "id" SERIAL PRIMARY KEY,
        "userId" integer NOT NULL,
        "projectId" varchar(64) NOT NULL,
        "projectRole" "project_membership_projectrole_enum" NOT NULL DEFAULT 'viewer',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "project-membership-unique" UNIQUE ("userId", "projectId")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_project_membership_user'
        ) THEN
          ALTER TABLE "project_membership"
          ADD CONSTRAINT "FK_project_membership_user"
          FOREIGN KEY ("userId") REFERENCES "user"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_project_membership_project'
        ) THEN
          ALTER TABLE "project_membership"
          ADD CONSTRAINT "FK_project_membership_project"
          FOREIGN KEY ("projectId") REFERENCES "project"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_project_membership_projectId"
      ON "project_membership" ("projectId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_project_membership_userId"
      ON "project_membership" ("userId")
    `);

    await queryRunner.query(`
      ALTER TABLE "test_run"
      ADD COLUMN IF NOT EXISTS "projectId" varchar(64)
    `);

    await queryRunner.query(`
      ALTER TABLE "test_run"
      ALTER COLUMN "projectId" SET DEFAULT 'default'
    `);

    await queryRunner.query(`
      UPDATE "test_run"
      SET "projectId" = 'default'
      WHERE "projectId" IS NULL OR btrim("projectId") = ''
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_test_run_projectId"
      ON "test_run" ("projectId")
    `);

    await queryRunner.query(`
      UPDATE "project"
      SET "key" = CONCAT("key", '-', SUBSTRING(md5("id"), 1, 8))
      WHERE "key" = 'default' AND "id" <> 'default'
    `);

    await queryRunner.query(`
      INSERT INTO "project" (
        "id",
        "name",
        "key",
        "description",
        "isDefault",
        "isArchived"
      )
      VALUES (
        'default',
        'Default Project',
        'default',
        'System default project for legacy and shared data',
        true,
        false
      )
      ON CONFLICT ("id")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "key" = EXCLUDED."key",
        "description" = EXCLUDED."description",
        "isDefault" = true,
        "isArchived" = false,
        "updatedAt" = now()
    `);

    await queryRunner.query(`
      UPDATE "project"
      SET "isDefault" = CASE WHEN "id" = 'default' THEN true ELSE false END
      WHERE "isDefault" = true OR "id" = 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_test_run_projectId"`);
    await queryRunner.query(
      `ALTER TABLE "test_run" DROP COLUMN IF EXISTS "projectId"`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_project_membership_project'
        ) THEN
          ALTER TABLE "project_membership"
          DROP CONSTRAINT "FK_project_membership_project";
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_project_membership_user'
        ) THEN
          ALTER TABLE "project_membership"
          DROP CONSTRAINT "FK_project_membership_user";
        END IF;
      END
      $$;
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_project_membership_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_project_membership_userId"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "project_membership"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project"`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'project_membership_projectrole_enum'
        ) THEN
          DROP TYPE "project_membership_projectrole_enum";
        END IF;
      END
      $$;
    `);
  }
}
