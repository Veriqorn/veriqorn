import { MigrationInterface, QueryRunner } from "typeorm";
import { hash } from "bcrypt";

export class AddInitialUser1703520000002 implements MigrationInterface {
  name = "AddInitialUser1703520000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const email = process.env.BACKEND_BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BACKEND_BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password) {
      return;
    }

    // Check if any users exist. Initial credentials must never be compiled into a migration.
    const users = await queryRunner.query(`SELECT * FROM "user" LIMIT 1`);

    if (!users.length) {
      const hashedPassword = await hash(password, 10);
      await queryRunner.query(
        `
                INSERT INTO "user" (name, email, password, role)
                VALUES ($1, $2, $3, $4)
            `,
        ["Administrator", email, hashedPassword, "admin"],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // No down migration needed for initial data
  }
}
