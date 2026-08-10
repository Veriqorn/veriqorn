import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Project } from "./project.entity";
import { User } from "./user.entity";

export type ProjectRole = "owner" | "maintainer" | "viewer";

@Entity("project_membership")
@Unique("project-membership-unique", ["userId", "projectId"])
export class ProjectMembership {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "integer" })
  userId: number;

  @Column({ type: "varchar", length: 64 })
  projectId: string;

  @Column({
    type: "enum",
    enum: ["owner", "maintainer", "viewer"],
    default: "viewer",
  })
  projectRole: ProjectRole;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.projectMemberships, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "userId" })
  user: User;

  @ManyToOne(() => Project, (project) => project.memberships, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "projectId" })
  project: Project;
}
