import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { URUGUAY_LOCATION_SEED_ROWS } from "../tests/discovery/fixtures/uruguay-location-seed.ts";

const outputPath = resolve(process.cwd(), "tests/discovery/fixtures/uruguay-location-seed.xlsx");
mkdirSync(dirname(outputPath), { recursive: true });

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("places");
const headers = Object.keys(URUGUAY_LOCATION_SEED_ROWS[0] ?? {});
sheet.addRow(headers);
for (const row of URUGUAY_LOCATION_SEED_ROWS) {
  sheet.addRow(headers.map((h) => (row as Record<string, unknown>)[h] ?? null));
}
await workbook.xlsx.writeFile(outputPath);
console.log("generated", outputPath, "with", URUGUAY_LOCATION_SEED_ROWS.length, "rows");
