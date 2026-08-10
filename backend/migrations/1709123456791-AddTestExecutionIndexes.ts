import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTestExecutionIndexes1709123456791
  implements MigrationInterface
{
  name = "AddTestExecutionIndexes1709123456791";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add indexes for test execution queries
    await queryRunner.query(`
      CREATE INDEX "idx_test_runs_name" ON "test_runs" ("name");
      CREATE INDEX "idx_test_runs_tags" ON "test_runs" USING gin ("tags");
      CREATE INDEX "idx_test_results_name" ON "test_results" ("name");
      CREATE INDEX "idx_test_results_test_run_id" ON "test_results" ("test_run_id");
    `);

    // Add full-text search capabilities
    await queryRunner.query(`
      ALTER TABLE "test_runs" ADD COLUMN "search_vector" tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B')
      ) STORED;

      CREATE INDEX "idx_test_runs_search" ON "test_runs" USING gin("search_vector");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "idx_test_runs_search";
      ALTER TABLE "test_runs" DROP COLUMN "search_vector";
      DROP INDEX "idx_test_results_test_run_id";
      DROP INDEX "idx_test_results_name";
      DROP INDEX "idx_test_runs_tags";
      DROP INDEX "idx_test_runs_name";
    `);
  }
}
