import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1709123456789 implements MigrationInterface {
  name = "InitialSchema1709123456789";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "role" character varying NOT NULL DEFAULT 'user',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    // Create test_runs table
    await queryRunner.query(`
      CREATE TABLE "test_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "start_time" TIMESTAMP NOT NULL DEFAULT now(),
        "end_time" TIMESTAMP,
        "status" character varying NOT NULL DEFAULT 'running',
        CONSTRAINT "PK_test_runs" PRIMARY KEY ("id")
      )
    `);

    // Create test_results table
    await queryRunner.query(`
      CREATE TABLE "test_results" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "status" character varying NOT NULL,
        "parameters" jsonb,
        "steps" jsonb,
        "start_time" TIMESTAMP NOT NULL DEFAULT now(),
        "end_time" TIMESTAMP,
        "duration" integer,
        "test_run_id" uuid,
        CONSTRAINT "PK_test_results" PRIMARY KEY ("id"),
        CONSTRAINT "FK_test_results_test_run" FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE
      )
    `);

    // Create test_artifacts table
    await queryRunner.query(`
      CREATE TABLE "test_artifacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "type" character varying NOT NULL,
        "path" character varying NOT NULL,
        "uploaded_at" TIMESTAMP NOT NULL DEFAULT now(),
        "test_result_id" uuid,
        CONSTRAINT "PK_test_artifacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_test_artifacts_test_result" FOREIGN KEY ("test_result_id") REFERENCES "test_results"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "test_artifacts"`);
    await queryRunner.query(`DROP TABLE "test_results"`);
    await queryRunner.query(`DROP TABLE "test_runs"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
