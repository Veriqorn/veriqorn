import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddKbViewerRole1763300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL enum: add new value if it doesn't exist
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'kb_viewer'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role_enum')
        ) THEN
          ALTER TYPE "user_role_enum" ADD VALUE 'kb_viewer';
        END IF;
      EXCEPTION
        WHEN undefined_object THEN
          -- enum type doesn't exist (role stored as varchar), skip
          NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL doesn't support removing enum values easily.
    // This is a no-op for safety.
  }
}
