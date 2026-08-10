import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTestStepTable1746724521343 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "test_step" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "status" character varying NOT NULL,
                "statusDetails" jsonb,
                "stage" character varying NOT NULL,
                "startTime" TIMESTAMP NOT NULL,
                "endTime" TIMESTAMP NOT NULL,
                "parameters" jsonb,
                "testResultId" uuid,
                "parentStepId" uuid,
                CONSTRAINT "PK_test_step" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_test_result"
            FOREIGN KEY ("testResultId")
            REFERENCES "test_results"("id")
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE "test_step"
            ADD CONSTRAINT "FK_test_step_parent_step"
            FOREIGN KEY ("parentStepId")
            REFERENCES "test_step"("id")
            ON DELETE CASCADE
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "test_step"
            DROP CONSTRAINT "FK_test_step_parent_step"
        `);

    await queryRunner.query(`
            ALTER TABLE "test_step"
            DROP CONSTRAINT "FK_test_step_test_result"
        `);

    await queryRunner.query(`
            DROP TABLE "test_step"
        `);
  }
}
