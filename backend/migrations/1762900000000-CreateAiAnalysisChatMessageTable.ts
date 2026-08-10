import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiAnalysisChatMessageTable1762900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_analysis_chat_message" (
        "id" SERIAL PRIMARY KEY,
        "testResultId" varchar(255) NOT NULL,
        "testRunId" integer NOT NULL,
        "role" varchar(20) NOT NULL,
        "content" text NOT NULL,
        "authorName" varchar(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_analysis_chat_message_testResultId"
      ON "ai_analysis_chat_message" ("testResultId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ai_analysis_chat_message"`,
    );
  }
}
