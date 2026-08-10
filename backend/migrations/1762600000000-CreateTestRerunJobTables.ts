import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from "typeorm";

export class CreateTestRerunJobTables1762600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "test_rerun_job",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            default: "uuid_generate_v4()",
          },
          {
            name: "parentRunId",
            type: "int",
          },
          {
            name: "childRunId",
            type: "int",
            isNullable: true,
          },
          {
            name: "projectId",
            type: "varchar",
            length: "64",
          },
          {
            name: "requestedByUserId",
            type: "varchar",
            length: "64",
          },
          {
            name: "status",
            type: "varchar",
            length: "16",
            default: "'queued'",
          },
          {
            name: "framework",
            type: "varchar",
            length: "32",
          },
          {
            name: "executionMode",
            type: "varchar",
            length: "32",
          },
          {
            name: "selectionMode",
            type: "varchar",
            length: "32",
          },
          {
            name: "executionProfileId",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "triggerMode",
            type: "varchar",
            length: "32",
            default: "'tests_only'",
          },
          {
            name: "selectors",
            type: "json",
            default: "'[]'",
          },
          {
            name: "metadata",
            type: "json",
            isNullable: true,
          },
          {
            name: "message",
            type: "text",
            isNullable: true,
          },
          {
            name: "startedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "completedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "test_rerun_job",
      new TableIndex({
        name: "IDX_test_rerun_job_project_created",
        columnNames: ["projectId", "createdAt"],
      }),
    );

    await queryRunner.createIndex(
      "test_rerun_job",
      new TableIndex({
        name: "IDX_test_rerun_job_parent_run",
        columnNames: ["parentRunId"],
      }),
    );

    await queryRunner.createIndex(
      "test_rerun_job",
      new TableIndex({
        name: "IDX_test_rerun_job_status",
        columnNames: ["status"],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "test_rerun_job_item",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            default: "uuid_generate_v4()",
          },
          {
            name: "rerunJobId",
            type: "uuid",
          },
          {
            name: "selectorKind",
            type: "varchar",
            length: "32",
          },
          {
            name: "selectorValue",
            type: "varchar",
            length: "400",
          },
          {
            name: "testResultId",
            type: "uuid",
            isNullable: true,
          },
          {
            name: "status",
            type: "varchar",
            length: "16",
            default: "'queued'",
          },
          {
            name: "message",
            type: "text",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      "test_rerun_job_item",
      new TableForeignKey({
        name: "FK_test_rerun_job_item_job",
        columnNames: ["rerunJobId"],
        referencedTableName: "test_rerun_job",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      }),
    );

    await queryRunner.createIndex(
      "test_rerun_job_item",
      new TableIndex({
        name: "IDX_test_rerun_job_item_job",
        columnNames: ["rerunJobId"],
      }),
    );

    await queryRunner.createIndex(
      "test_rerun_job_item",
      new TableIndex({
        name: "IDX_test_rerun_job_item_status",
        columnNames: ["status"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      "test_rerun_job_item",
      "IDX_test_rerun_job_item_status",
    );
    await queryRunner.dropIndex(
      "test_rerun_job_item",
      "IDX_test_rerun_job_item_job",
    );
    await queryRunner.dropForeignKey(
      "test_rerun_job_item",
      "FK_test_rerun_job_item_job",
    );
    await queryRunner.dropTable("test_rerun_job_item");

    await queryRunner.dropIndex("test_rerun_job", "IDX_test_rerun_job_status");
    await queryRunner.dropIndex(
      "test_rerun_job",
      "IDX_test_rerun_job_parent_run",
    );
    await queryRunner.dropIndex(
      "test_rerun_job",
      "IDX_test_rerun_job_project_created",
    );
    await queryRunner.dropTable("test_rerun_job");
  }
}
