import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { TestRun } from "./test-run.entity";

export enum TestResultStatus {
  PASSED = "passed",
  FAILED = "failed",
  SKIPPED = "skipped",
  BROKEN = "broken",
}

@Entity("test_result")
export class TestResult {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ generated: "uuid" })
  uuid: string; // Original Allure UUID

  @Column()
  name: string;

  @Column({
    type: "enum",
    enum: TestResultStatus,
    default: TestResultStatus.BROKEN,
  })
  status: TestResultStatus;

  @Column({ type: "timestamp" })
  startTime: Date;

  @Column({ type: "timestamp" })
  endTime: Date;

  @Column({ nullable: true })
  duration: number;

  @ManyToOne(() => TestRun, (testRun) => testRun.results)
  @JoinColumn({ name: "testRunId", referencedColumnName: "id" })
  testRun: TestRun;

  @Column({ type: "int", nullable: true })
  testRunId: number;

  @OneToMany("TestStep", (step: any) => step.testResult, { cascade: true })
  steps: any[];

  @OneToMany("TestAttachment", (attachment: any) => attachment.testResult, { cascade: true })
  attachments: any[];

  @OneToMany("TestArtifact", (artifact: any) => artifact.testResult, { cascade: true })
  artifacts: any[];

  @Column({ type: "json", nullable: true })
  labels?: Array<{ name?: string; value?: unknown }>;

  @Column({ type: "json", nullable: true })
  parameters: any[];
}
