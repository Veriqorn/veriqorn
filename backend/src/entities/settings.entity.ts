import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";

@Entity("settings")
export class Settings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 255, unique: true })
  key: string;

  @Column({ type: "text" })
  value: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  updatedAt: Date;
}
