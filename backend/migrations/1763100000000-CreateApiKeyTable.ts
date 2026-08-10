import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateApiKeyTable1763100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "api_key" (
        "id" SERIAL PRIMARY KEY,
        "userId" integer NOT NULL,
        "keyHash" varchar(64) NOT NULL,
        "keyPrefix" varchar(12) NOT NULL,
        "name" varchar(255) NOT NULL,
        "lastUsedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_api_key_keyHash"
      ON "api_key" ("keyHash")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_api_key_userId"
      ON "api_key" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "api_key"`);
  }
}
