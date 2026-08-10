import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from "typeorm";
import { TestResult } from "./test-result.entity";
import { TestStep } from "./test-step.entity";

@Entity("test_attachment")
export class TestAttachment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  type: string;

  @Column()
  source: string;

  @Column({ type: "bytea", nullable: true })
  content: Buffer;

  @Column({ type: "varchar", length: 16, default: "database" })
  storageType: "database" | "minio";

  @Column({ type: "varchar", length: 255, nullable: true })
  storageBucket: string | null;

  @Column({ type: "varchar", length: 1024, nullable: true })
  objectKey: string | null;

  @Column({ type: "int", nullable: true })
  size: number | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  checksum: string | null;

  @ManyToOne(() => TestResult, (testResult) => testResult.attachments)
  testResult: TestResult;

  @ManyToOne(() => TestStep, (step) => step.attachments)
  step: TestStep;
}
