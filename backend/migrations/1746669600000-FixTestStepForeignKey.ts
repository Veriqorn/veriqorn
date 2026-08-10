import { MigrationInterface, QueryRunner } from "typeorm";

export class FixTestStepForeignKey1746669600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First drop the existing foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_result"
        `);

    // Add the correct foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_result"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_result"("id")
            ON DELETE CASCADE
        `);

    console.log("Fixed foreign key constraint for test_step table");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the corrected foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_result"
        `);

    // Add back the original (incorrect) foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_result"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_results"("id")
            ON DELETE CASCADE
        `);
  }
}
