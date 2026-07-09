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

// ============================================================================
// 持久化数据资源表（库存表 / 工单调拨齐套报表）
// 这两类表为「全局共享」资源：上传后长期保存，可随时预览，
// 且要求每天更新。新任务只需上传 BOM，匹配时自动引用最新的库存/工单。
// 文件本身存于磁盘持久目录（bom-resources），元数据存于此表。
// ============================================================================
export const bomResources = pgTable("bom_resources", {
  /** 资源标识：inventory | work_order */
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  /** 持久目录中的原始文件名 */
  storedName: text("stored_name").notNull(),
  originalName: text("original_name"),
  /** 解析后的文件元数据（ParsedFile） */
  meta: jsonb("meta").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type BomResource = typeof bomResources.$inferSelect;
