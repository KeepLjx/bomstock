import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { calculateRealtime } from "@/lib/inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 导出实时可用库存计算结果为 Excel。
 * GET:  使用全局 active 口径
 * POST: { jobIds?, runPhase3? } 模拟口径
 */
async function buildExcel(result: Awaited<ReturnType<typeof calculateRealtime>>) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("实时可用库存", { views: [{ state: "frozen", ySplit: 1 }] });

  const headers = ["物料编码", "名称", "规格", "基线库存", "预扣减", "可用库存", "欠料", "状态"];
  ws.getRow(1).values = headers;
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F3F4" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  let r = 2;
  for (const m of result.materials) {
    const short = m.shortage > 0;
    const low = !short && m.reservedQty > 0 && m.availableQty < m.reservedQty;
    const row = ws.getRow(r);
    row.values = [
      m.materialCode,
      m.materialName || "",
      m.spec || "",
      m.baseQty,
      m.reservedQty,
      m.availableQty,
      short ? m.shortage : "",
      short ? "欠料" : low ? "紧张" : "充足",
    ];
    if (short) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
      });
      row.getCell(6).font = { color: { argb: "FF9C0006" }, bold: true };
    } else if (low) {
      row.getCell(6).font = { color: { argb: "FFB06000" } };
    } else {
      row.getCell(6).font = { color: { argb: "FF137333" } };
    }
    r++;
  }

  // 列宽
  ws.columns.forEach((col, i) => {
    col.width = [22, 28, 22, 14, 14, 14, 14, 10][i] ?? 16;
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const runPhase3 = sp.get("phase3") !== "false";
    const result = await calculateRealtime({ runPhase3 });
    const buf = await buildExcel(result);
    const name = `实时可用库存_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `导出失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const jobIds = Array.isArray(body.jobIds)
      ? body.jobIds.map((x: unknown) => String(x)).filter(Boolean)
      : undefined;
    const runPhase3 = body.runPhase3 !== false;
    const result = await calculateRealtime({ selectedJobIds: jobIds, runPhase3 });
    const buf = await buildExcel(result);
    const tag = jobIds ? "模拟" : "全局";
    const name = `${tag}可用库存_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: `导出失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
