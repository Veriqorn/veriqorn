import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiAnalysisResultTable1762800000000
  implements MigrationInterface
{
  name = "CreateAiAnalysisResultTable1762800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_analysis_result" (
        "id" SERIAL PRIMARY KEY,
        "testResultId" character varying(255) NOT NULL,
        "allureId" character varying(255),
        "testRunId" integer NOT NULL,
        "summary" text NOT NULL,
        "likelyRootCauses" jsonb NOT NULL DEFAULT '[]',
        "confidence" float NOT NULL DEFAULT 0,
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "warnings" jsonb DEFAULT '[]',
        "model" character varying(255) NOT NULL,
        "generatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_ai_analysis_result_testResultId" ON "ai_analysis_result" ("testResultId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_analysis_result_allureId" ON "ai_analysis_result" ("allureId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ai_analysis_result"`);
  }
}
