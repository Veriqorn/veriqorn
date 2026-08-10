import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

import type { TestRerunJob, TestRerunJobStatus, TestRerunSelectorKind } from "./test-rerun-job.entity";

@Entity("test_rerun_job_item")
@Index("IDX_test_rerun_job_item_job", ["rerunJobId"])
@Index("IDX_test_rerun_job_item_status", ["status"])
export class TestRerunJobItem {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  rerunJobId: string;

  @ManyToOne("TestRerunJob", (job: TestRerunJob) => job.items, { onDelete: "CASCADE" })
  @JoinColumn({ name: "rerunJobId", referencedColumnName: "id" })
  rerunJob: TestRerunJob;

  @Column({ type: "varchar", length: 32 })
  selectorKind: TestRerunSelectorKind;

  @Column({ type: "varchar", length: 400 })
  selectorValue: string;

  @Column({ type: "uuid", nullable: true })
  testResultId?: string;

  @Column({ type: "varchar", length: 16, default: "queued" })
  status: TestRerunJobStatus;

  @Column({ type: "text", nullable: true })
  message?: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  updatedAt: Date;
}
