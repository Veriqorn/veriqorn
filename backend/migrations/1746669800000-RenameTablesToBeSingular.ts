import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameTablesToBeSingular1746669800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, drop foreign key constraints
    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_results"
        `);

    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_result"
        `);

    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_result"
            DROP CONSTRAINT IF EXISTS "FK_test_result_test_run"
        `);

    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_results"
            DROP CONSTRAINT IF EXISTS "FK_test_results_test_runs"
        `);

    // Rename tables if they exist in plural form
    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_results" 
            RENAME TO "test_result"
        `);

    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_runs" 
            RENAME TO "test_run"
        `);

    // Update the test_step.testResultId column type to match test_result.id
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ALTER COLUMN "testResultId" TYPE character varying
        `);

    // Recreate foreign key constraints with singular table names
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_result"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_result"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "test_result"
            ADD CONSTRAINT "FK_test_result_test_run"
            FOREIGN KEY ("testRunId")
            REFERENCES "test_run"("id")
            ON DELETE CASCADE
        `);

    console.log(
      "Renamed tables to use singular form and updated foreign key constraints",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // First, drop foreign key constraints
    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_result"
        `);

    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_result"
            DROP CONSTRAINT IF EXISTS "FK_test_result_test_run"
        `);

    // Rename tables back to plural form
    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_result" 
            RENAME TO "test_results"
        `);

    await queryRunner.query(`
            ALTER TABLE IF EXISTS "test_run" 
            RENAME TO "test_runs"
        `);

    // Update the test_step.testResultId column type back to uuid
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ALTER COLUMN "testResultId" TYPE uuid USING "testResultId"::uuid
        `);

    // Recreate foreign key constraints with plural table names
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_results"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_results"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "test_results"
            ADD CONSTRAINT "FK_test_results_test_runs"
            FOREIGN KEY ("testRunId")
            REFERENCES "test_runs"("id")
            ON DELETE CASCADE
        `);
  }
}
