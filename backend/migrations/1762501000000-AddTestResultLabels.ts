import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTestResultLabels1762501000000 implements MigrationInterface {
  name = "AddTestResultLabels1762501000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "test_result"
      ADD COLUMN IF NOT EXISTS "labels" json
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "test_result"
      DROP COLUMN IF EXISTS "labels"
    `);
  }
}
