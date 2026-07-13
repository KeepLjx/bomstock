import { NextRequest, NextResponse } from "next/server";
import {
  saveResourceUpload,
  upsertResource,
  getResource,
  listResources,
  resourceFilePath,
} from "@/lib/bom/storage";
import { cleanExcelToCSV, detectFileKind } from "@/lib/bom/parse";
import { detectSetsFromCSV } from "@/lib/bom/parse";
import { parsedFileToDTO } from "@/lib/bom/dto";
import {
  extractInventoryRows,
} from "@/lib/inventory";
import {
  persistInventorySnapshots,
  clearInventorySnapshots,
  setCurrentInventory,
} from "@/lib/bom/store";
import { db } from "@/db";
import { bomResources } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ParsedFile } from "@/lib/bom/types";
import path from "node:path";
import fs from "node:fs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_SIZE = 60 * 1024 * 1024;
/** 判断某资源的 updatedAt 是否为「今天」（服务端时区，避免客户端时区偏差） */
function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
/** 资源 id <-> kind 映射 */
const KIND_OF: Record<string, string> = {
  inventory: "inventory",
  work_order: "work_order",
};
/** GET：列出持久资源及其「今日是否已更新」状态 */
export async function GET() {
  const rows = await listResources();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const build = (id: string) => {
    const r = byId.get(id);
    if (!r) {
      return { id, exists: false, updatedToday: false };
    }
    return {
      id,
      exists: true,
      updatedToday: isToday(r.updatedAt),
      updatedAt: r.updatedAt.toISOString(),
      file: parsedFileToDTO(r.meta),
    };
  };
  return NextResponse.json({
    inventory: build("inventory"),
    workOrder: build("work_order"),
  });
}
interface ParseResult {
  meta: ParsedFile;
}
/** 解析上传的 Excel 为 ParsedFile（保存到持久目录 + 清洗 CSV） */
async function parseResource(
  kind: string,
  file: File,
): Promise<ParseResult> {
  const buf = Buffer.from(await file.arrayBuffer());
  const { storedName, filePath } = saveResourceUpload(file.name, buf);
  const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
  const csvPath = path.join(path.dirname(filePath), csvName);
  const cleaned = await cleanExcelToCSV(filePath, csvPath);
  const detectedKind = detectFileKind(file.name, cleaned.columns);
  const meta: ParsedFile = {
    storedName,
    originalName: file.name,
    size: file.size,
    kind: detectedKind,
    sheets: cleaned.sheets,
    mainSheet: cleaned.mainSheet,
    rowCount: cleaned.rowCount,
    headerRow: cleaned.headerRow,
    headers: cleaned.columns,
    headerMap: cleaned.headerMap,
    hasYiboCode: cleaned.hasYiboCode,
    csvName,
    removedColumnCount: cleaned.removedColumnCount,
    ignoredChangeLog: cleaned.ignoredChangeLog,
  };
  // 检测套数（库存/工单/BOM 均可能用到）
  try {
    const sets = await detectSetsFromCSV(csvPath, meta.headers);
    meta.detectedSets = sets;
  } catch {
    meta.detectedSets = null;
  }
  // 校验文件类型匹配（库存应为 inventory，工单应为 transfer/bills）
  const expectedKind = kind === "inventory" ? "inventory" : "transfer";
  if (detectedKind !== expectedKind && detectedKind !== "bills") {
    // 仅作软提示，不阻断（表头可能不全）
  }
  void storedName;
  return { meta };
}
/** POST：上传/更新某个持久资源（form: kind=inventory|work_order, file） */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const kind = String(form.get("kind") ?? "").trim();
    const file = form.getAll("files").find((f): f is File => f instanceof File);
    if (!KIND_OF[kind]) {
      return NextResponse.json(
        { error: "kind 必须为 inventory 或 work_order" },
        { status: 400 },
      );
    }
    if (!file) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `文件 ${file.name} 超过 ${MAX_SIZE / 1024 / 1024}MB 限制` },
        { status: 400 },
      );
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      return NextResponse.json(
        { error: `文件 ${file.name} 不是 Excel 文件，仅支持 .xlsx/.xlsm` },
        { status: 400 },
      );
    }
    const id = kind === "inventory" ? "inventory" : "work_order";
    // 删除旧资源文件（避免堆积）
    const old = await getResource(id);
    if (old) {
      try {
        if (old.meta.storedName && fs.existsSync(resourceFilePath(old.meta.storedName))) {
          fs.unlinkSync(resourceFilePath(old.meta.storedName));
        }
        if (old.meta.csvName && fs.existsSync(resourceFilePath(old.meta.csvName))) {
          fs.unlinkSync(resourceFilePath(old.meta.csvName));
        }
      } catch {
        // 忽略
      }
    }
    const { meta } = await parseResource(kind, file);
    await upsertResource(id, KIND_OF[kind], meta.storedName, meta.originalName, meta);

    // 库存资源：生成持久标准化快照 + 设为 current（与仪表盘上传口径一致）
    let snapshotRows = 0;
    if (kind === "inventory" && meta.csvName) {
      await db
        .update(bomResources)
        .set({
          resourceType: "inventory",
          isCurrent: true,
          effectiveDate: new Date().toISOString().slice(0, 10),
          updatedAt: new Date(),
        })
        .where(eq(bomResources.id, id));
      await clearInventorySnapshots(id);
      const rows = extractInventoryRows(resourceFilePath(meta.csvName));
      await persistInventorySnapshots(id, rows, new Date().toISOString().slice(0, 10));
      snapshotRows = rows.length;
    }

    const updated = await getResource(id);
    return NextResponse.json({
      id,
      kind: KIND_OF[kind],
      exists: true,
      updatedToday: updated ? isToday(updated.updatedAt) : true,
      updatedAt: updated?.updatedAt.toISOString(),
      file: parsedFileToDTO(meta),
      snapshotRows,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `保存资源失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
