import {
  pgTable,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ============================================================================
// BOM 工作流任务表
// 存储任务元数据、解析结果、配置与执行摘要（文件本身存于磁盘临时目录）
// ============================================================================

export const bomJobs = pgTable("bom_jobs", {
  id: text("id").primaryKey(),
  name: text("name"),
  status: text("status").notNull().default("parsed"),
  files: jsonb("files").$type<unknown>(),
  config: jsonb("config").$type<unknown>(),
  summary: jsonb("summary").$type<unknown>(),
  outputFileName: text("output_file_name"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BomJob = typeof bomJobs.$inferSelect;
