import { MigrationInterface, QueryRunner } from "typeorm";

export class DropUsersTable1703520000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // No down migration needed
  }
}
