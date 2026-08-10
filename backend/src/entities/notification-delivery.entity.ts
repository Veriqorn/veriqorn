import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type NotificationDestinationType = "slack" | "telegram" | "email" | "webhook";
export type NotificationEventType = "run-completion" | "run-failed" | "run-broken" | string;

export type NotificationDeliveryStatus = "sent" | "failed" | "skipped";
export type NotificationTriggerSource = "run-completion" | "manual-test";

@Entity("notification_delivery")
@Index("IDX_notification_delivery_project_created", ["projectId", "createdAt"])
@Index("IDX_notification_delivery_dedupe", ["dedupeKey"])
export class NotificationDelivery {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 64 })
  projectId: string;

  @Column({ type: "varchar", length: 64 })
  event: NotificationEventType;

  @Column({ type: "varchar", length: 64 })
  destinationId: string;

  @Column({ type: "varchar", length: 32 })
  destinationType: NotificationDestinationType;

  @Column({ type: "varchar", length: 16 })
  status: NotificationDeliveryStatus;

  @Column({ type: "int", default: 1 })
  attempt: number;

  @Column({ type: "varchar", length: 255 })
  dedupeKey: string;

  @Column({ type: "int", nullable: true })
  runId?: number;

  @Column({ type: "int", nullable: true })
  responseCode?: number;

  @Column({ type: "text", nullable: true })
  requestPayload?: string;

  @Column({ type: "text", nullable: true })
  responseBody?: string;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "varchar", length: 32, default: "run-completion" })
  triggeredBy: NotificationTriggerSource;

  @Column({ type: "timestamp", nullable: true })
  deliveredAt?: Date;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;
}
