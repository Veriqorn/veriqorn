import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTestStepAttachment1746724600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "test_step_attachment" (
                "id" SERIAL NOT NULL,
                "name" character varying NOT NULL,
                "type" character varying NOT NULL,
                "source" character varying,
                "content" text,
                "stepId" uuid,
                CONSTRAINT "PK_test_step_attachment" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            ALTER TABLE "test_step_attachment"
            ADD CONSTRAINT "FK_test_step_attachment_step"
            FOREIGN KEY ("stepId")
            REFERENCES "test_step"("id")
            ON DELETE CASCADE
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "test_step_attachment"
            DROP CONSTRAINT "FK_test_step_attachment_step"
        `);

    await queryRunner.query(`
            DROP TABLE "test_step_attachment"
        `);
  }
}
