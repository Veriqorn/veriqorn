import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from "typeorm";
import { TestResult } from "./test-result.entity";

@Entity("test_artifact")
export class TestArtifact {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  type: "trace" | "screenshot" | "video" | "log";

  @Column()
  path: string;

  @Column({ type: "timestamp" })
  uploadedAt: Date;

  @ManyToOne(() => TestResult, (testResult) => testResult.artifacts)
  testResult: TestResult;
}
