import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ChatConversation } from "./chat-conversation.entity";

@Entity("chat_message")
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: "int" })
  conversationId: number;

  @Column({ type: "varchar", length: 20 })
  role: string;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "jsonb", nullable: true })
  codeReferences: Array<{
    filePath: string;
    snippet: string;
    repositoryId?: string;
    relevanceScore?: number;
  }> | null;

  @Column({ type: "jsonb", nullable: true })
  tokenUsage: { promptTokens?: number; completionTokens?: number } | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  model: string | null;

  @ManyToOne(() => ChatConversation, (conv) => conv.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "conversationId" })
  conversation: ChatConversation;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
