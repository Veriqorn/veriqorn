import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHybridAttachmentStorage1763400000000
  implements MigrationInterface
{
  name = "AddHybridAttachmentStorage1763400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable("test_attachment");
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      ADD COLUMN IF NOT EXISTS "storageType" varchar(16) NOT NULL DEFAULT 'database'
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      ADD COLUMN IF NOT EXISTS "storageBucket" varchar(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      ADD COLUMN IF NOT EXISTS "objectKey" varchar(1024)
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      ADD COLUMN IF NOT EXISTS "size" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      ADD COLUMN IF NOT EXISTS "checksum" varchar(64)
    `);

    await queryRunner.query(`
      UPDATE "test_attachment"
      SET "storageType" = 'database'
      WHERE "storageType" IS NULL OR btrim("storageType") = ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable("test_attachment");
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      DROP COLUMN IF EXISTS "checksum"
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      DROP COLUMN IF EXISTS "size"
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      DROP COLUMN IF EXISTS "objectKey"
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      DROP COLUMN IF EXISTS "storageBucket"
    `);
    await queryRunner.query(`
      ALTER TABLE "test_attachment"
      DROP COLUMN IF EXISTS "storageType"
    `);
  }
}
