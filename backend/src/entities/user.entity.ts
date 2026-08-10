import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ type: "enum", enum: ["admin", "user", "kb_viewer"], default: "user" })
  role: "admin" | "user" | "kb_viewer";

  @Column({ type: "int", default: 0 })
  sessionVersion: number;

  @OneToMany("ProjectMembership", (membership: any) => membership.user)
  projectMemberships: any[];
}
