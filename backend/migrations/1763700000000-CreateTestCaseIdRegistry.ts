import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateTestCaseIdRegistry1763700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: "test_case_id_registry",
      columns: [
        { name: "id", type: "uuid", isPrimary: true, default: "uuid_generate_v4()" },
        { name: "projectId", type: "varchar", length: "64" },
        { name: "testCaseId", type: "varchar", length: "128" },
        { name: "testIdentity", type: "varchar", length: "400" },
        { name: "testName", type: "varchar", length: "400", isNullable: true },
        { name: "status", type: "varchar", length: "16", default: "'reserved'" },
        { name: "reservedBy", type: "varchar", length: "128", isNullable: true },
        { name: "claimedAt", type: "timestamp", isNullable: true },
        { name: "lastSeenAt", type: "timestamp" },
        { name: "conflictCount", type: "int", default: "0" },
        { name: "lastConflictingIdentity", type: "varchar", length: "400", isNullable: true },
        { name: "lastConflictingName", type: "varchar", length: "400", isNullable: true },
        { name: "lastConflictAt", type: "timestamp", isNullable: true },
        { name: "createdAt", type: "timestamp", default: "CURRENT_TIMESTAMP" },
        { name: "updatedAt", type: "timestamp", default: "CURRENT_TIMESTAMP" },
      ],
    }), true);
    await queryRunner.createIndex("test_case_id_registry", new TableIndex({ name: "UQ_test_case_id_registry_project_id", columnNames: ["projectId", "testCaseId"], isUnique: true }));
    await queryRunner.createIndex("test_case_id_registry", new TableIndex({ name: "IDX_test_case_id_registry_project_status", columnNames: ["projectId", "status"] }));
    await queryRunner.createTable(new Table({
      name: "test_case_id_sequence",
      columns: [
        { name: "projectId", type: "varchar", length: "64", isPrimary: true },
        { name: "nextValue", type: "bigint" },
      ],
    }), true);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("test_case_id_sequence");
    await queryRunner.dropTable("test_case_id_registry");
  }
}
