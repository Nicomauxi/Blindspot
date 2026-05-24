import type { FastifyInstance } from "fastify";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";
import { getAuthUser, requireAdmin } from "../../auth/middleware.js";
import {
  validateDiscoveryPlaceEntry,
  upsertDiscoveryPlaces,
  listDiscoveryPlaces,
  type DiscoveryPlaceKind,
} from "../../../../src/storage/discovery-places.js";

const IMPORT_ROW_LIMIT = 2000;

export async function discoveryPlacesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/discovery/places",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      const kind = query["kind"] as DiscoveryPlaceKind | undefined;
      const parent_location = query["parent_location"];
      const q = query["q"];
      const limit = query["limit"] ? Math.min(Number(query["limit"]), 500) : 200;

      const places = await listDiscoveryPlaces({
        ...(kind ? { kind } : {}),
        ...(parent_location ? { parent_location } : {}),
        ...(q ? { q } : {}),
        limit,
      });

      return reply.status(200).send({ data: places, total: places.length });
    }
  );

  app.post(
    "/admin/discovery/places/import",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const upsert = (request.query as Record<string, string>)["upsert"] === "true";

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded", error_code: "missing_file" });
      }

      const mime = data.mimetype;
      const filename = data.filename ?? "";
      const isXlsx =
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mime === "application/vnd.ms-excel" ||
        filename.endsWith(".xlsx") ||
        filename.endsWith(".xls");

      if (!isXlsx) {
        return reply.status(400).send({ error: "File must be .xlsx or .xls", error_code: "invalid_file_type" });
      }

      const buffer = await data.toBuffer();
      let workbook;
      try {
        workbook = xlsxRead(buffer, { type: "buffer" });
      } catch {
        return reply.status(400).send({ error: "Failed to parse XLSX file", error_code: "parse_error" });
      }

      const sheetName = workbook.SheetNames.includes("places")
        ? "places"
        : workbook.SheetNames[0];
      if (!sheetName) {
        return reply.status(400).send({ error: "XLSX file has no sheets", error_code: "empty_workbook" });
      }

      const sheet = workbook.Sheets[sheetName]!;
      const rows = xlsxUtils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
      });

      if (rows.length === 0) {
        return reply.status(400).send({ error: "Sheet has no data rows", error_code: "empty_sheet" });
      }

      if (rows.length > IMPORT_ROW_LIMIT) {
        return reply.status(400).send({
          error: `Sheet exceeds ${IMPORT_ROW_LIMIT} rows`,
          error_code: "row_limit_exceeded",
          details: { row_count: rows.length, limit: IMPORT_ROW_LIMIT },
        });
      }

      const validEntries = [];
      const rowErrors: Array<{ row: number; reason: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        const result = validateDiscoveryPlaceEntry(rows[i]!, i + 2);
        if ("error" in result) {
          rowErrors.push({ row: i + 2, reason: result.error });
        } else {
          validEntries.push(result.entry);
        }
      }

      if (rowErrors.length > 0 && validEntries.length === 0) {
        return reply.status(422).send({
          error: "All rows failed validation",
          error_code: "all_rows_invalid",
          row_errors: rowErrors,
        });
      }

      const result = await upsertDiscoveryPlaces(validEntries, authUser.id, upsert);

      return reply.status(200).send({
        data: {
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          row_validation_errors: rowErrors,
          upsert_errors: result.errors.filter((e) => !e.reason.includes("duplicate")),
          duplicate_keys: result.errors
            .filter((e) => e.reason.includes("duplicate"))
            .map((e) => e.location_key),
        },
      });
    }
  );
}
