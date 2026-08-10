import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKbArticleTable1763200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_article" (
        "id" SERIAL PRIMARY KEY,
        "projectId" integer NOT NULL,
        "slug" varchar(255) NOT NULL,
        "title" varchar(500) NOT NULL,
        "content" text NOT NULL,
        "category" varchar(100) NOT NULL,
        "order" integer NOT NULL DEFAULT 0,
        "generatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "indexVersion" varchar(100),
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_kb_article_project_slug" UNIQUE ("projectId", "slug")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kb_article_projectId"
      ON "kb_article" ("projectId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kb_article_category"
      ON "kb_article" ("category")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kb_article_projectId_category_order"
      ON "kb_article" ("projectId", "category", "order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_article"`);
  }
}
