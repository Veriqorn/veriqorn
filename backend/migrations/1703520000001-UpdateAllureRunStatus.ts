import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateAllureRunStatus1703520000001 implements MigrationInterface {
  name = "UpdateAllureRunStatus1703520000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      // Check if the table exists first
      const hasTable = await queryRunner.hasTable("allure_run");
      if (!hasTable) {
        return; // Skip if table doesn't exist
      }

      // Check if status column exists
      const table = await queryRunner.getTable("allure_run");
      const statusColumn = table?.findColumnByName("status");

      if (!statusColumn) {
        await queryRunner.query(
          `ALTER TABLE "allure_run" ADD "status" character varying`,
        );
        await queryRunner.query(
          `UPDATE "allure_run" SET "status" = 'completed' WHERE "status" IS NULL`,
        );
        await queryRunner.query(
          `ALTER TABLE "allure_run" ALTER COLUMN "status" SET NOT NULL`,
        );
      }
    } catch (error) {
      console.warn(
        "Migration UpdateAllureRunStatus1703520000001 failed:",
        error.message,
      );
      // Don't throw error since this is a defensive migration
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // No down migration needed since we're just ensuring column exists
  }
}
