import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateTestRunSchema1746646612000 implements MigrationInterface {
  name = "UpdateTestRunSchema1746646612000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to test_run table
    await queryRunner.query(
      `ALTER TABLE test_run ADD COLUMN IF NOT EXISTS uuid VARCHAR`,
    );
    await queryRunner.query(
      `ALTER TABLE test_run ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE test_run ADD COLUMN IF NOT EXISTS environment VARCHAR`,
    );
    await queryRunner.query(
      `ALTER TABLE test_run ADD COLUMN IF NOT EXISTS branch VARCHAR DEFAULT 'master'`,
    );

    // Set uuid to match the current id for existing records
    await queryRunner.query(`UPDATE test_run SET uuid = id WHERE uuid IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the added columns
    await queryRunner.query(`ALTER TABLE test_run DROP COLUMN IF EXISTS uuid`);
    await queryRunner.query(`ALTER TABLE test_run DROP COLUMN IF EXISTS tags`);
    await queryRunner.query(
      `ALTER TABLE test_run DROP COLUMN IF EXISTS environment`,
    );
    await queryRunner.query(
      `ALTER TABLE test_run DROP COLUMN IF EXISTS branch`,
    );
  }
}
