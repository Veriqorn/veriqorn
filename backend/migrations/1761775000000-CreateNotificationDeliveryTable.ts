import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateNotificationDeliveryTable1761775000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "notification_delivery",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            default: "uuid_generate_v4()",
          },
          {
            name: "projectId",
            type: "varchar",
            length: "64",
          },
          {
            name: "event",
            type: "varchar",
            length: "64",
          },
          {
            name: "destinationId",
            type: "varchar",
            length: "64",
          },
          {
            name: "destinationType",
            type: "varchar",
            length: "32",
          },
          {
            name: "status",
            type: "varchar",
            length: "16",
          },
          {
            name: "attempt",
            type: "int",
            default: "1",
          },
          {
            name: "dedupeKey",
            type: "varchar",
            length: "255",
          },
          {
            name: "runId",
            type: "int",
            isNullable: true,
          },
          {
            name: "responseCode",
            type: "int",
            isNullable: true,
          },
          {
            name: "requestPayload",
            type: "text",
            isNullable: true,
          },
          {
            name: "responseBody",
            type: "text",
            isNullable: true,
          },
          {
            name: "errorMessage",
            type: "text",
            isNullable: true,
          },
          {
            name: "triggeredBy",
            type: "varchar",
            length: "32",
            default: "'run-completion'",
          },
          {
            name: "deliveredAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      "notification_delivery",
      new TableIndex({
        name: "IDX_notification_delivery_project_created",
        columnNames: ["projectId", "createdAt"],
      }),
    );

    await queryRunner.createIndex(
      "notification_delivery",
      new TableIndex({
        name: "IDX_notification_delivery_dedupe",
        columnNames: ["dedupeKey"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      "notification_delivery",
      "IDX_notification_delivery_project_created",
    );
    await queryRunner.dropIndex(
      "notification_delivery",
      "IDX_notification_delivery_dedupe",
    );
    await queryRunner.dropTable("notification_delivery");
  }
}
