import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateChatTables1763000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_conversation" (
        "id" SERIAL PRIMARY KEY,
        "title" varchar(255) NOT NULL DEFAULT 'New Chat',
        "userId" integer NOT NULL,
        "projectId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_conversation_userId"
      ON "chat_conversation" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_conversation_projectId"
      ON "chat_conversation" ("projectId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_message" (
        "id" SERIAL PRIMARY KEY,
        "conversationId" integer NOT NULL,
        "role" varchar(20) NOT NULL,
        "content" text NOT NULL,
        "codeReferences" jsonb,
        "tokenUsage" jsonb,
        "model" varchar(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_chat_message_conversation"
          FOREIGN KEY ("conversationId")
          REFERENCES "chat_conversation" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_message_conversationId"
      ON "chat_message" ("conversationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_conversation"`);
  }
}
