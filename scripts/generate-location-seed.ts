import { utils, writeFile } from "xlsx";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { URUGUAY_LOCATION_SEED_ROWS } from "../tests/discovery/fixtures/uruguay-location-seed.ts";

const outputPath = resolve(process.cwd(), "tests/discovery/fixtures/uruguay-location-seed.xlsx");
mkdirSync(dirname(outputPath), { recursive: true });

const workbook = utils.book_new();
const sheet = utils.json_to_sheet(URUGUAY_LOCATION_SEED_ROWS);
utils.book_append_sheet(workbook, sheet, "places");
writeFile(workbook, outputPath, { bookType: "xlsx" });
console.log("generated", outputPath, "with", URUGUAY_LOCATION_SEED_ROWS.length, "rows");
