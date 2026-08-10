import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from "typeorm";

import type { TestRerunJobItem } from "./test-rerun-job-item.entity";

export type TestRerunFramework = "junit" | "playwright" | "testng";
export type TestRerunExecutionMode = "agent" | "ci-webhook";
export type TestRerunTriggerMode = "full_pipeline" | "tests_only";
export type TestRerunJobStatus = "canceled" | "completed" | "failed" | "queued" | "running";
export type TestRerunSelectionMode = "failed_or_broken" | "selected" | "single";
export type TestRerunSelectorKind = "allureId" | "frameworkId" | "historyId" | "testName";

export interface TestRerunSelectorContract {
  kind: TestRerunSelectorKind;
  value: string;
  testResultId?: string;
}

@Entity("test_rerun_job")
@Index("IDX_test_rerun_job_project_created", ["projectId", "createdAt"])
@Index("IDX_test_rerun_job_parent_run", ["parentRunId"])
@Index("IDX_test_rerun_job_status", ["status"])
export class TestRerunJob {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "int" })
  parentRunId: number;

  @Column({ type: "int", nullable: true })
  childRunId?: number;

  @Column({ type: "varchar", length: 64 })
  projectId: string;

  @Column({ type: "varchar", length: 64 })
  requestedByUserId: string;

  @Column({ type: "varchar", length: 16, default: "queued" })
  status: TestRerunJobStatus;

  @Column({ type: "varchar", length: 32 })
  framework: TestRerunFramework;

  @Column({ type: "varchar", length: 32 })
  executionMode: TestRerunExecutionMode;

  @Column({ type: "varchar", length: 32 })
  selectionMode: TestRerunSelectionMode;

  @Column({ type: "varchar", length: 64, nullable: true })
  executionProfileId?: string;

  @Column({ type: "varchar", length: 32, default: "tests_only" })
  triggerMode: TestRerunTriggerMode;

  @Column({ type: "json", default: () => "'[]'" })
  selectors: TestRerunSelectorContract[];

  @Column({ type: "json", nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  message?: string;

  @Column({ type: "timestamp", nullable: true })
  startedAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  completedAt?: Date;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  updatedAt: Date;

  @OneToMany("TestRerunJobItem", (item: TestRerunJobItem) => item.rerunJob, { cascade: true })
  items: TestRerunJobItem[];
}
