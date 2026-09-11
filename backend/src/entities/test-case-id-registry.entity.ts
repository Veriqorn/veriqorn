import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type TestCaseIdRegistryStatus = "reserved" | "claimed" | "conflicted";

/** The authoritative, project-scoped owner of an externally visible test ID. */
@Entity("test_case_id_registry")
@Index("UQ_test_case_id_registry_project_id", ["projectId", "testCaseId"], { unique: true })
@Index("IDX_test_case_id_registry_project_status", ["projectId", "status"])
export class TestCaseIdRegistry {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 64 })
  projectId: string;

  @Column({ type: "varchar", length: 128 })
  testCaseId: string;

  @Column({ type: "varchar", length: 400 })
  testIdentity: string;

  @Column({ type: "varchar", length: 400, nullable: true })
  testName?: string | null;

  @Column({ type: "varchar", length: 16, default: "reserved" })
  status: TestCaseIdRegistryStatus;

  @Column({ type: "varchar", length: 128, nullable: true })
  reservedBy?: string | null;

  @Column({ type: "timestamp", nullable: true })
  claimedAt?: Date | null;

  @Column({ type: "timestamp" })
  lastSeenAt: Date;

  @Column({ type: "int", default: 0 })
  conflictCount: number;

  @Column({ type: "varchar", length: 400, nullable: true })
  lastConflictingIdentity?: string | null;

  @Column({ type: "varchar", length: 400, nullable: true })
  lastConflictingName?: string | null;

  @Column({ type: "timestamp", nullable: true })
  lastConflictAt?: Date | null;

  @Column({ type: "timestamp", default: "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp", default: "CURRENT_TIMESTAMP" })
  updatedAt: Date;
}
