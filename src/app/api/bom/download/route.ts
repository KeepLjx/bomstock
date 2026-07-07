import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { loadJob, filePathOf, jobDir } from "@/lib/bom/storage";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    const storedName = req.nextUrl.searchParams.get("file");
    if (!jobId || !storedName) {
      return NextResponse.json(
        { error: "缺少 jobId 或 file 参数" },
        { status: 400 },
      );
    }

    const state = await loadJob(jobId);
    if (!state) {
      return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    }

    // 允许下载该任务目录内的任意文件（含编辑导出文件）。
    // 校验：文件名不含路径分隔符，且实际路径位于任务目录内（防目录穿越）。
    if (storedName.includes("/") || storedName.includes("\\") || storedName.includes("..")) {
      return NextResponse.json({ error: "非法文件名" }, { status: 400 });
    }
    const filePath = filePathOf(jobId, storedName);
    const jobRoot = jobDir(jobId);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(jobRoot) + path.sep) && resolved !== path.resolve(jobRoot)) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "文件已从临时存储中移除，请重新上传处理" },
        { status: 404 },
      );
    }

    const data = fs.readFileSync(filePath);
    const isCsv = /\.csv$/i.test(storedName);
    const displayName =
      storedName === state.outputFileName
        ? state.outputFileName
        : state.files.find(
            (f) => f.storedName === storedName || f.csvName === storedName,
          )?.originalName ?? storedName;

    // 中文文件名 RFC 5987 编码
    const encoded = encodeURIComponent(
      isCsv ? displayName.replace(/\.(xlsx|xlsm|xls)$/i, "") + "_清洗.csv" : displayName,
    );
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": isCsv
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
        "Content-Length": String(data.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `下载失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
