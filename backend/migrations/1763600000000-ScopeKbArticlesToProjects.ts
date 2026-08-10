import type { MigrationInterface, QueryRunner } from "typeorm";

/** Existing legacy KB records are deliberately assigned to the default project. */
export class ScopeKbArticlesToProjects1763600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kb_article" DROP CONSTRAINT IF EXISTS "UQ_kb_article_project_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kb_article_projectId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kb_article_projectId_category_order"`);
    await queryRunner.query(`
      ALTER TABLE "kb_article"
      ALTER COLUMN "projectId" TYPE varchar(64) USING 'default'::varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "kb_article"
      ADD CONSTRAINT "UQ_kb_article_project_slug" UNIQUE ("projectId", "slug")
    `);
    await queryRunner.query(`
      ALTER TABLE "kb_article"
      ADD CONSTRAINT "FK_kb_article_project"
      FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`CREATE INDEX "IDX_kb_article_projectId" ON "kb_article" ("projectId")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_kb_article_projectId_category_order"
      ON "kb_article" ("projectId", "category", "order")
    `);
  }

  public async down(): Promise<void> {
    throw new Error("ScopeKbArticlesToProjects migration is irreversible because legacy IDs were intentionally mapped to the default project.");
  }
}
