// 端到端测试：生成样本 Excel（含 change log sheet + 空列 + 纯色列），
// 跑通 清洗CSV -> orchestrator，验证输出
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const ROOT = path.join(os.tmpdir(), "bom-test-" + Date.now());
fs.mkdirSync(ROOT, { recursive: true });

function fill(color: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: color } };
}

async function makeBom() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOM");
  ws.getRow(1).values = [
    "Item", // A
    "Reference", // B
    "", // C - 空列（应剔除）
    "存货编码", // D
    "Quantity", // E
    "一博物料编码", // F
    "", // G - 仅颜色无字符（应剔除）
    "一博物料库存", // H
    "一博问题", // I
    "零件状态", // J
    "单机用量", // K
    "小计", // L
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = fill("FFD9E1F2");
  // G1 只有颜色无文字
  ws.getCell(1, 7).fill = fill("FFFF0000");

  const rows = [
    ["0120405000034", 2, "C0018956", "10K+", "", "正常供货", 2],
    ["0120405000035", 2, "C0018957", "1K+", "", "正常供货", 2],
    ["0120405000036", 2, "R0008878", "1K-", "", "停产", 3],
    ["0120405000037", 2, "R0008879", "5K+", "请确认精度", "正常供货", 3],
    ["0120405000038", 2, "R0008880", "1K-", "缺货", "不用于新设计", 4],
    ["0120405000039", 2, "R0008881", "", "", "正常供货", 1],
  ];
  rows.forEach((r, i) => {
    const row = i + 2;
    ws.getRow(row).values = [
      i + 1, `U${i + 1}`, "", r[0], r[6], r[2], "", r[3], r[4], r[5], r[6], r[6] * 2,
    ];
    // G 列给颜色无文字
    ws.getCell(row, 7).fill = fill("FFFFC000");
  });

  // 额外的 change log sheet（应被忽略）
  const log = wb.addWorksheet("change log");
  log.getRow(1).values = ["版本", "日期", "说明"];
  log.getRow(2).values = ["v1", "2024-01-01", "初始版本"];

  const file = path.join(ROOT, "S801PE1600TP.xlsx");
  await wb.xlsx.writeFile(file);
  return file;
}

async function makeInventory() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("库存");
  ws.getRow(1).values = ["物料编码", "物料名称", "", "总数量"]; // C 空列
  ws.getRow(1).font = { bold: true };
  const data: [string, string, number][] = [
    ["C023219-0120405000034", "电阻A", 50000],
    ["C023219-0120405000035", "电阻B", 3],
    ["C023219-0120405000036", "电容C", 1],
    ["C023219-0120405000037", "电容D", 1],
    ["C023219-0120405000038", "IC", 2],
  ];
  data.forEach((d, i) => {
    ws.getRow(i + 2).values = [d[0], d[1], "", d[2]];
  });
  const file = path.join(ROOT, "物料库存查询.xlsx");
  await wb.xlsx.writeFile(file);
  return file;
}

async function main() {
  process.env.BOM_STORAGE_DIR = ROOT;
  const { cleanExcelToCSV } = await import("../src/lib/bom/parse.ts");
  const { executeWorkflow } = await import("../src/lib/bom/orchestrator.ts");

  const bomPath = await makeBom();
  const invPath = await makeInventory();

  const jobId = "testjob";
  const dir = path.join(ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const bomStored = "bom.xlsx";
  const invStored = "inv.xlsx";
  fs.copyFileSync(bomPath, path.join(dir, bomStored));
  fs.copyFileSync(invPath, path.join(dir, invStored));

  const bomCsv = "bom.csv";
  const invCsv = "inv.csv";
  const bomMeta = await cleanExcelToCSV(path.join(dir, bomStored), path.join(dir, bomCsv));
  const invMeta = await cleanExcelToCSV(path.join(dir, invStored), path.join(dir, invCsv));

  console.log("=== BOM CLEAN ===");
  console.log("mainSheet:", bomMeta.mainSheet, "ignored:", bomMeta.ignoredChangeLog);
  console.log("columns:", Object.values(bomMeta.columns));
  console.log("removedColumnCount:", bomMeta.removedColumnCount, "rows:", bomMeta.rowCount);
  console.log("=== INV CLEAN ===");
  console.log("columns:", Object.values(invMeta.columns), "removed:", invMeta.removedColumnCount);

  // 验证 CSV 内容
  const bomCsvText = fs.readFileSync(path.join(dir, bomCsv), "utf8");
  console.log("\n=== BOM CSV (first 400 chars) ===");
  console.log(bomCsvText.slice(0, 400));

  const state = {
    id: jobId,
    status: "parsed" as const,
    createdAt: Date.now(),
    files: [
      {
        storedName: bomStored,
        csvName: bomCsv,
        originalName: "S801PE1600TP.xlsx",
        size: 0,
        kind: "bom" as const,
        role: "target" as const,
        sheets: bomMeta.sheets,
        mainSheet: bomMeta.mainSheet,
        rowCount: bomMeta.rowCount,
        headerRow: bomMeta.headerRow,
        headers: bomMeta.columns,
        headerMap: bomMeta.headerMap,
        hasYiboCode: bomMeta.hasYiboCode,
      },
      {
        storedName: invStored,
        csvName: invCsv,
        originalName: "物料库存查询.xlsx",
        size: 0,
        kind: "inventory" as const,
        sheets: invMeta.sheets,
        mainSheet: invMeta.mainSheet,
        rowCount: invMeta.rowCount,
        headerRow: invMeta.headerRow,
        headers: invMeta.columns,
        headerMap: invMeta.headerMap,
        hasYiboCode: false,
      },
    ],
  };

  const { summary, outputPath } = await executeWorkflow({
    jobId,
    state,
    config: {
      targetBom: { storedName: bomStored, originalName: "S801PE1600TP.xlsx", role: "target", sets: 2 },
      inventory: { storedName: invStored, originalName: "物料库存查询.xlsx" },
      inventoryMapping: {},
      occupiedBoms: [],
      targetMapping: {},
      runPhase2: true,
      runPhase3: false,
    },
  });

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("Output:", outputPath);

  // 验证输出
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outputPath);
  const ws = wb.getWorksheet("BOM")!;
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, col) => {
    headers[col] = String(c.value);
  });
  console.log("\n=== OUTPUT HEADERS ===");
  headers.forEach((h, i) => h && console.log(`  Col ${i}: ${h}`));
  const supplyCol = headers.indexOf("供料方式");
  console.log("\n=== SUPPLY RESULTS ===");
  for (let r = 2; r <= 7; r++) {
    console.log(`  Row ${r}: ${ws.getCell(r, headers.indexOf("存货编码")).value} -> ${ws.getCell(r, supplyCol).value}`);
  }

  // 断言
  const removedOk = bomMeta.removedColumnCount === 2; // C 和 G
  const ignoredOk = bomMeta.ignoredChangeLog.includes("change log");
  const noEmptyHeader = !headers.some((h) => h === "");
  console.log("\n=== ASSERTIONS ===");
  console.log("BOM removed 2 cols (C empty, G color-only):", removedOk ? "PASS" : "FAIL");
  console.log("change log ignored:", ignoredOk ? "PASS" : "FAIL");
  console.log("output has no empty headers:", noEmptyHeader ? "PASS" : "FAIL");
  console.log("supply column present:", supplyCol > 0 ? "PASS" : "FAIL");

  const allPass = removedOk && ignoredOk && noEmptyHeader && supplyCol > 0 && summary.totalRows === 6;
  console.log("\n" + (allPass ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
