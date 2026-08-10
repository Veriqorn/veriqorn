import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { TestStep } from "./test-step.entity";

@Entity()
export class TestStepAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  type: string;

  @Column({ nullable: true })
  source: string;

  @Column({ type: "text", nullable: true })
  content: string;

  @ManyToOne(() => TestStep, (step) => step.attachments)
  @JoinColumn()
  step: TestStep;
}
