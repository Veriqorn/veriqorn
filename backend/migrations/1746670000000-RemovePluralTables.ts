import { MigrationInterface, QueryRunner } from "typeorm";

export class RemovePluralTables1746670000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if plural tables exist
    const checkTestResultsTable = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'test_results'
            );
        `);

    const checkTestRunsTable = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'test_runs'
            );
        `);

    const testResultsExists = checkTestResultsTable[0].exists;
    const testRunsExists = checkTestRunsTable[0].exists;

    console.log(`test_results table exists: ${testResultsExists}`);
    console.log(`test_runs table exists: ${testRunsExists}`);

    if (testResultsExists) {
      // First, check if test_result table already exists
      const checkTestResultTable = await queryRunner.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'test_result'
                );
            `);

      const testResultExists = checkTestResultTable[0].exists;

      if (!testResultExists) {
        // Drop foreign key constraints first
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_step"
                    DROP CONSTRAINT IF EXISTS "FK_test_step_test_results";
                `);

        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_artifacts"
                    DROP CONSTRAINT IF EXISTS "FK_test_artifacts_test_results";
                `);

        // Rename test_results to test_result
        await queryRunner.query(`
                    ALTER TABLE "test_results" 
                    RENAME TO "test_result";
                `);

        console.log("Renamed test_results table to test_result");

        // Recreate foreign key constraints
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_step"
                    ADD CONSTRAINT "FK_test_step_test_result"
                    FOREIGN KEY ("testResultId")
                    REFERENCES "test_result"("id")
                    ON DELETE CASCADE;
                `);

        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_artifacts"
                    ADD CONSTRAINT "FK_test_artifacts_test_result"
                    FOREIGN KEY ("test_result_id")
                    REFERENCES "test_result"("id")
                    ON DELETE CASCADE;
                `);
      } else {
        console.log(
          "Both test_results and test_result tables exist. Keeping both for now to avoid data loss.",
        );
      }
    }

    if (testRunsExists) {
      // First, check if test_run table already exists
      const checkTestRunTable = await queryRunner.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'test_run'
                );
            `);

      const testRunExists = checkTestRunTable[0].exists;

      if (!testRunExists) {
        // Drop foreign key constraints first
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_results"
                    DROP CONSTRAINT IF EXISTS "FK_test_results_test_runs";
                `);

        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_result"
                    DROP CONSTRAINT IF EXISTS "FK_test_result_test_runs";
                `);

        // Rename test_runs to test_run
        await queryRunner.query(`
                    ALTER TABLE "test_runs" 
                    RENAME TO "test_run";
                `);

        console.log("Renamed test_runs table to test_run");

        // Recreate foreign key constraints
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_result"
                    ADD CONSTRAINT "FK_test_result_test_run"
                    FOREIGN KEY ("testRunId")
                    REFERENCES "test_run"("id")
                    ON DELETE CASCADE;
                `);
      } else {
        console.log(
          "Both test_runs and test_run tables exist. Keeping both for now to avoid data loss.",
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check if singular tables exist
    const checkTestResultTable = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'test_result'
            );
        `);

    const checkTestRunTable = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'test_run'
            );
        `);

    const testResultExists = checkTestResultTable[0].exists;
    const testRunExists = checkTestRunTable[0].exists;

    if (testResultExists) {
      // First, check if test_results table already exists
      const checkTestResultsTable = await queryRunner.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'test_results'
                );
            `);

      const testResultsExists = checkTestResultsTable[0].exists;

      if (!testResultsExists) {
        // Drop foreign key constraints first
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_step"
                    DROP CONSTRAINT IF EXISTS "FK_test_step_test_result";
                `);

        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_artifacts"
                    DROP CONSTRAINT IF EXISTS "FK_test_artifacts_test_result";
                `);

        // Rename test_result to test_results
        await queryRunner.query(`
                    ALTER TABLE "test_result" 
                    RENAME TO "test_results";
                `);

        // Recreate foreign key constraints
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_step"
                    ADD CONSTRAINT "FK_test_step_test_results"
                    FOREIGN KEY ("testResultId")
                    REFERENCES "test_results"("id")
                    ON DELETE CASCADE;
                `);

        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_artifacts"
                    ADD CONSTRAINT "FK_test_artifacts_test_results"
                    FOREIGN KEY ("test_result_id")
                    REFERENCES "test_results"("id")
                    ON DELETE CASCADE;
                `);
      }
    }

    if (testRunExists) {
      // First, check if test_runs table already exists
      const checkTestRunsTable = await queryRunner.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'test_runs'
                );
            `);

      const testRunsExists = checkTestRunsTable[0].exists;

      if (!testRunsExists) {
        // Drop foreign key constraints first
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_result"
                    DROP CONSTRAINT IF EXISTS "FK_test_result_test_run";
                `);

        // Rename test_run to test_runs
        await queryRunner.query(`
                    ALTER TABLE "test_run" 
                    RENAME TO "test_runs";
                `);

        // Recreate foreign key constraints
        await queryRunner.query(`
                    ALTER TABLE IF EXISTS "test_results"
                    ADD CONSTRAINT "FK_test_results_test_runs"
                    FOREIGN KEY ("testRunId")
                    REFERENCES "test_runs"("id")
                    ON DELETE CASCADE;
                `);
      }
    }
  }
}
