import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAttachmentStorageConnection1763800000000 implements MigrationInterface {
  name = "AddAttachmentStorageConnection1763800000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable("test_attachment")) return;
    await queryRunner.query('ALTER TABLE "test_attachment" ADD COLUMN IF NOT EXISTS "storageConnectionId" varchar(64)');
    // NULL deliberately means the original MINIO_* environment connection.
    // No existing object or reference is moved by this migration.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable("test_attachment")) return;
    const rows = await queryRunner.query('SELECT 1 FROM "test_attachment" WHERE "storageConnectionId" IS NOT NULL LIMIT 1');
    if (rows.length) throw new Error("Migrate attachments back to legacy storage before reverting this migration");
    await queryRunner.query('ALTER TABLE "test_attachment" DROP COLUMN IF EXISTS "storageConnectionId"');
  }
}
