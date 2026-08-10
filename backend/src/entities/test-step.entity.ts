import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { TestResult } from "./test-result.entity";

@Entity("test_step")
export class TestStep {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  status: string;

  @Column({ type: "json", nullable: true })
  statusDetails: any;

  @Column()
  stage: string;

  @Column({ type: "timestamp" })
  startTime: Date;

  @Column({ type: "timestamp" })
  endTime: Date;

  @ManyToOne(() => TestResult, (testResult: any) => testResult.steps, { eager: false })
  @JoinColumn({ name: "testResultId" })
  testResult: TestResult;

  @ManyToOne("TestStep", (step: any) => step.childSteps)
  parentStep: TestStep;

  @OneToMany("TestStep", (step: any) => step.parentStep, { cascade: true })
  childSteps: TestStep[];

  @OneToMany("TestAttachment", (attachment: any) => attachment.step, { cascade: true })
  attachments: any[];

  @OneToMany("TestStepAttachment", (attachment: any) => attachment.step, { cascade: true })
  stepAttachments: any[];

  @Column({ type: "json", nullable: true })
  parameters: any[];
}
