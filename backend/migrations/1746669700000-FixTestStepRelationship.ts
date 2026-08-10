import { MigrationInterface, QueryRunner } from "typeorm";

export class FixTestStepRelationship1746669700000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First drop the existing foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_result"
        `);

    // Change the testResultId column type to match the test_result table id column type
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ALTER COLUMN "testResultId" TYPE character varying
        `);

    // Add the correct foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_result"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_result"("id")
            ON DELETE CASCADE
        `);

    console.log("Fixed test_step relationship with test_result table");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the corrected foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            DROP CONSTRAINT IF EXISTS "FK_test_step_test_result"
        `);

    // Change the testResultId column type back to uuid
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ALTER COLUMN "testResultId" TYPE uuid USING "testResultId"::uuid
        `);

    // Add back the original foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_result"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_result"("id")
            ON DELETE CASCADE
        `);
  }
}
