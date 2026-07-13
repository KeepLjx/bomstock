import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  saveResourceUpload,
  resourceFilePath,
  upsertResource,
} from "@/lib/bom/storage";
import { cleanExcelToCSV } from "@/lib/bom/parse";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { parsedFileToDTO } from "@/lib/bom/dto";
import {
  fileHash,
  persistInventorySnapshots,
  setCurrentInventory,
} from "@/lib/bom/store";
import { extractInventoryRows } from "@/lib/inventory";
import { db } from "@/db";
import { bomResources } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ParsedFile } from "@/lib/bom/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SIZE = 60 * 1024 * 1024;

async function parseInventoryFile(file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  const { storedName, filePath } = saveResourceUpload(file.name, buf);
  const csvName = `${storedName.replace(/\.(xlsx|xlsm|xls)$/i, "")}.csv`;
  const csvPath = resourceFilePath(csvName);
  const cleaned = await cleanExcelToCSV(filePath, csvPath);
  const meta: ParsedFile = {
    storedName,
    originalName: file.name,
    size: file.size,
    kind: "inventory",
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
  return { meta, buf };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const file = form.getAll("files").find((f): f is File => f instanceof File);
    if (!file) {
      return NextResponse.json(
        { error: "请上传库存表文件（.xlsx）" },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `文件 ${file.name} 超过 ${MAX_SIZE / 1024 / 1024}MB 限制` },
        { status: 400 },
      );
    }
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name.toLowerCase())) {
      return NextResponse.json(
        { error: "仅支持 .xlsx/.xlsm 库存表文件" },
        { status: 400 },
      );
    }

    const { meta, buf } = await parseInventoryFile(file);
    const resourceId = `inv_${crypto.randomBytes(6).toString("hex")}`;
    const hash = fileHash(buf);
    const snapshotDate = new Date().toISOString().slice(0, 10);

    // 资源登记（覆盖同 id）
    await upsertResource(resourceId, "inventory", meta.storedName, file.name, meta);
    await db
      .update(bomResources)
      .set({
        uploadedBy: user.id,
        resourceType: "inventory",
        fileHash: hash,
        isCurrent: true,
        effectiveDate: snapshotDate,
        updatedAt: new Date(),
      })
      .where(eq(bomResources.id, resourceId));

    // 生成库存快照明细
    const rows = extractInventoryRows(resourceFilePath(meta.csvName!));

    // 设为 current（其余 inventory 置为非 current）
    await setCurrentInventory(resourceId);
    await persistInventorySnapshots(resourceId, rows, snapshotDate);

    await writeAudit({
      userId: user.id,
      action: "upload_inventory",
      targetType: "resource",
      targetId: resourceId,
      detail: { originalName: file.name, rows: rows.length, hash },
    });

    return NextResponse.json({
      resourceId,
      rows: rows.length,
      snapshotDate,
      file: parsedFileToDTO(meta),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `上传库存表失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
