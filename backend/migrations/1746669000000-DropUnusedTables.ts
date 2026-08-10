import { MigrationInterface, QueryRunner } from "typeorm";

export class DropUnusedTables1746669000000 implements MigrationInterface {
  name = "DropUnusedTables1746669000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if allure_attachment table exists before dropping
    const hasAllureAttachmentTable =
      await queryRunner.hasTable("allure_attachment");
    if (hasAllureAttachmentTable) {
      // Drop foreign key constraints first
      await queryRunner.query(
        `ALTER TABLE "allure_attachment" DROP CONSTRAINT IF EXISTS "FK_allure_attachment_allure_test"`,
      );
      await queryRunner.query(`DROP TABLE "allure_attachment"`);
    }

    // Check if allure_test table exists before dropping
    const hasAllureTestTable = await queryRunner.hasTable("allure_test");
    if (hasAllureTestTable) {
      // Drop foreign key constraints first
      await queryRunner.query(
        `ALTER TABLE "allure_test" DROP CONSTRAINT IF EXISTS "FK_allure_test_allure_run"`,
      );
      await queryRunner.query(`DROP TABLE "allure_test"`);
    }

    // Check if allure_run table exists before dropping
    const hasAllureRunTable = await queryRunner.hasTable("allure_run");
    if (hasAllureRunTable) {
      await queryRunner.query(`DROP TABLE "allure_run"`);
    }

    // Check if test_artifact (singular) table exists before dropping
    // We're standardizing on test_artifacts (plural)
    const hasTestArtifactTable = await queryRunner.hasTable("test_artifact");
    if (hasTestArtifactTable) {
      await queryRunner.query(`DROP TABLE "test_artifact"`);
    }

    // Note: We're keeping test_run, test_runs, test_result, test_results, and test_artifacts tables
    // as they are actively used by the application
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // We don't need to recreate these tables in the down migration
    // as they are being removed because they're no longer used
    console.log(
      "This migration cannot be reverted as it removes unused tables.",
    );
  }
}
