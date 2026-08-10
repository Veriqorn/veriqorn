import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTestExecutionFields1709123456790 implements MigrationInterface {
  name = "AddTestExecutionFields1709123456790";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add description and tags to test_runs table
    await queryRunner.query(`
      ALTER TABLE "test_runs"
      ADD COLUMN "description" text,
      ADD COLUMN "tags" text[] DEFAULT '{}';
    `);

    // Add environment and metadata to test_results table
    await queryRunner.query(`
      ALTER TABLE "test_results"
      ADD COLUMN "environment" jsonb,
      ADD COLUMN "metadata" jsonb;
    `);

    // Add indexes for better query performance
    await queryRunner.query(`
      CREATE INDEX "idx_test_runs_status" ON "test_runs" ("status");
      CREATE INDEX "idx_test_runs_start_time" ON "test_runs" ("start_time");
      CREATE INDEX "idx_test_results_status" ON "test_results" ("status");
      CREATE INDEX "idx_test_results_start_time" ON "test_results" ("start_time");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove indexes
    await queryRunner.query(`
      DROP INDEX "idx_test_results_start_time";
      DROP INDEX "idx_test_results_status";
      DROP INDEX "idx_test_runs_start_time";
      DROP INDEX "idx_test_runs_status";
    `);

    // Remove columns from test_results table
    await queryRunner.query(`
      ALTER TABLE "test_results"
      DROP COLUMN "metadata",
      DROP COLUMN "environment";
    `);

    // Remove columns from test_runs table
    await queryRunner.query(`
      ALTER TABLE "test_runs"
      DROP COLUMN "tags",
      DROP COLUMN "description";
    `);
  }
}
