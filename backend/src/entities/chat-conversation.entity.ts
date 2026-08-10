import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("chat_conversation")
export class ChatConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 255, default: "New Chat" })
  title: string;

  @Index()
  @Column({ type: "int" })
  userId: number;

  @Index()
  @Column({ type: "int", nullable: true })
  projectId: number | null;

  @OneToMany("ChatMessage", (msg: any) => msg.conversation)
  messages: any[];

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
