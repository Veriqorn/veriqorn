import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("api_key")
export class ApiKey {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "int" })
  userId: number;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  keyHash: string;

  @Column({ type: "varchar", length: 12 })
  keyPrefix: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "timestamp", nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @Column({ type: "timestamp", nullable: true })
  expiresAt: Date | null;
}
