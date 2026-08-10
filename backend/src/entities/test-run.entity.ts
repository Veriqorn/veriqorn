import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from "typeorm";

export interface TestRunStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  broken: number;
  passRate: number;
}

@Entity("test_run")
export class TestRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  uuid: string;

  @Column()
  name: string;

  @Column({ default: "running" })
  status: string;

  @Column({ type: "json", nullable: true })
  tags: string[];

  @Column({ nullable: true })
  environment: string;

  @Column({ nullable: true })
  branch: string;

  @Column({ type: "varchar", length: 64, nullable: true, default: "default" })
  projectId: string;
  // project-scope-column

  @Column({ type: "timestamp", nullable: true })
  startTime: Date;

  @Column({ type: "timestamp", nullable: true })
  endTime: Date;

  // These columns don't exist in the database schema
  // @CreateDateColumn()
  // createdAt: Date;

  // @UpdateDateColumn()
  // updatedAt: Date;

  @OneToMany("TestResult", (result: any) => result.testRun)
  results: any[];

  stats?: TestRunStats;

  // Commenting out the Project relationship since the projectId column doesn't exist in the database
  // @ManyToOne(() => Project, project => project.testRuns, { nullable: true })
  // project: Project;
}
