import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateTestResultUuid1708150000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing uuid column if it exists
    await queryRunner.query(`
            ALTER TABLE "test_result" DROP COLUMN IF EXISTS "uuid";
        `);

    // Add the uuid column with auto-generation
    await queryRunner.query(`
            ALTER TABLE "test_result" 
            ADD COLUMN "uuid" uuid DEFAULT uuid_generate_v4() NOT NULL;
        `);

    // Enable uuid-ossp extension if not already enabled
    await queryRunner.query(`
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "test_result" DROP COLUMN "uuid";
        `);
  }
}
