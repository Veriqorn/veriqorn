import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCompositePerformanceIndexes1762700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for test results filtered by run + status (launch details page)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_test_result_runId_status"
      ON "test_result" ("testRunId", "status")
    `);

    // Composite index for project-scoped run listing sorted by start time (launches page, dashboard)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_test_run_projectId_startTime"
      ON "test_run" ("projectId", "startTime" DESC)
    `);

    // Settings lookup by key (frequent reads from cache miss)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_settings_key"
      ON "settings" ("key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_test_result_runId_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_test_run_projectId_startTime"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_settings_key"`);
  }
}
