import type { FastifyInstance, FastifyRequest } from "fastify";
import { read as xlsxRead, utils as xlsxUtils } from "xlsx";
import { getDb } from "../../db/client.js";
import { getAuthUser, requireAdmin } from "../../auth/middleware.js";
import {
  validateDiscoveryPlaceEntry,
  upsertDiscoveryPlaces,
  listDiscoveryPlaces,
  type DiscoveryPlaceEntry,
  type DiscoveryPlaceKind,
} from "../../../../src/storage/discovery-places.js";

const IMPORT_ROW_LIMIT = 2000;
const HISTORY_LIMIT = 50;

type ImportRowError = { row: number; reason: string };
type ImportDuplicate = { location_key: string; display_name: string };

type ImportPreviewPayload = {
  filename: string;
  row_count: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  entries: DiscoveryPlaceEntry[];
  row_validation_errors: ImportRowError[];
  duplicate_entries: ImportDuplicate[];
};

type ImportHistoryEntry = {
  id: string;
  action: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  filename: string | null;
  row_count: number;
  inserted: number;
  updated: number;
  skipped: number;
  invalid_count: number;
  duplicate_count: number;
  upsert: boolean;
};

function isDiscoveryPlacesCatalogMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return normalized.includes("discovery_places_catalog") && (
    normalized.includes("could not find") ||
    normalized.includes("does not exist") ||
    normalized.includes("schema cache")
  );
}

function isXlsxUpload(mime: string, filename: string): boolean {
  return (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls")
  );
}

function parseWorkbookRows(buffer: Buffer): Record<string, unknown>[] {
  const workbook = xlsxRead(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.includes("places") ? "places" : workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("empty_workbook");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("empty_workbook");
  }

  return xlsxUtils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });
}

async function findExistingLocationKeys(locationKeys: string[]): Promise<Set<string>> {
  if (locationKeys.length === 0) return new Set();
  const db = getDb();
  const { data, error } = await db
    .from("discovery_places_catalog")
    .select("location_key")
    .in("location_key", locationKeys);

  if (error) {
    const wrapped = new Error(`Failed to check existing places: ${error.message}`);
    if (isDiscoveryPlacesCatalogMissing(wrapped)) return new Set();
    throw wrapped;
  }

  return new Set((data ?? []).map((row: { location_key: string }) => row.location_key));
}

async function buildImportPreview(filename: string, buffer: Buffer): Promise<ImportPreviewPayload> {
  const rows = parseWorkbookRows(buffer);

  if (rows.length === 0) {
    throw new Error("empty_sheet");
  }

  if (rows.length > IMPORT_ROW_LIMIT) {
    throw new Error("row_limit_exceeded");
  }

  const entries: DiscoveryPlaceEntry[] = [];
  const rowValidationErrors: ImportRowError[] = [];

  for (let index = 0; index < rows.length; index++) {
    const result = validateDiscoveryPlaceEntry(rows[index]!, index + 2);
    if ("error" in result) {
      rowValidationErrors.push({ row: index + 2, reason: result.error });
      continue;
    }
    entries.push(result.entry);
  }

  const existingKeys = await findExistingLocationKeys(entries.map((entry) => entry.location_key));
  const duplicateEntries = entries
    .filter((entry) => existingKeys.has(entry.location_key))
    .map((entry) => ({ location_key: entry.location_key, display_name: entry.display_name }));

  return {
    filename,
    row_count: rows.length,
    valid_count: entries.length,
    invalid_count: rowValidationErrors.length,
    duplicate_count: duplicateEntries.length,
    entries,
    row_validation_errors: rowValidationErrors,
    duplicate_entries: duplicateEntries,
  };
}

async function writeImportAuditLog(
  request: FastifyRequest,
  payload: {
    filename: string | null;
    row_count: number;
    inserted: number;
    updated: number;
    skipped: number;
    invalid_count: number;
    duplicate_count: number;
    upsert: boolean;
  }
): Promise<void> {
  const db = getDb();
  const actor = getAuthUser(request);
  await db.from("audit_log").insert({
    actor_user_id: actor.id,
    actor_role: actor.role,
    action: "discovery.places.import",
    target_type: "discovery_places_catalog",
    target_id: payload.filename ?? "manual-import",
    diff: {
      ...payload,
      created_at: new Date().toISOString(),
    },
    ip_address: request.ip ?? null,
    user_agent: request.headers["user-agent"] ?? null,
  });
}

async function listImportHistory(limit: number): Promise<ImportHistoryEntry[]> {
  const db = getDb();
  const { data, error } = await db
    .from("audit_log")
    .select("id, action, occurred_at, actor_user_id, actor_role, diff")
    .order("occurred_at", { ascending: false })
    .limit(Math.min(limit, HISTORY_LIMIT));

  if (error) {
    throw new Error(`Failed to list import history: ${error.message}`);
  }

  return (data ?? [])
    .filter((row: Record<string, unknown>) => row.action === "discovery.places.import")
    .map((row: Record<string, unknown>) => {
      const diff = (row.diff && typeof row.diff === "object" ? row.diff : {}) as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        action: String(row.action ?? "discovery.places.import"),
        occurred_at: String(row.occurred_at ?? ""),
        actor_user_id: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
        actor_role: typeof row.actor_role === "string" ? row.actor_role : null,
        filename: typeof diff.filename === "string" ? diff.filename : null,
        row_count: Number(diff.row_count ?? 0),
        inserted: Number(diff.inserted ?? 0),
        updated: Number(diff.updated ?? 0),
        skipped: Number(diff.skipped ?? 0),
        invalid_count: Number(diff.invalid_count ?? 0),
        duplicate_count: Number(diff.duplicate_count ?? 0),
        upsert: Boolean(diff.upsert),
      };
    });
}

function badFileReply(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, filename: string, mime: string) {
  return reply.status(400).send({
    error: "File must be .xlsx or .xls",
    error_code: "invalid_file_type",
    details: { filename, mime },
  });
}

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

      try {
        const places = await listDiscoveryPlaces({
          ...(kind ? { kind } : {}),
          ...(parent_location ? { parent_location } : {}),
          ...(q ? { q } : {}),
          limit,
        });

        return reply.status(200).send({ data: places, total: places.length });
      } catch (error) {
        if (isDiscoveryPlacesCatalogMissing(error)) {
          request.log.warn({ error }, "discovery places catalog missing; returning empty catalog");
          return reply.status(200).send({ data: [], total: 0, unavailable: "catalog_table_missing" });
        }
        throw error;
      }
    }
  );

  app.get(
    "/admin/imports/locations",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      const limit = query["limit"] ? Math.min(Number(query["limit"]), HISTORY_LIMIT) : 20;
      const history = await listImportHistory(limit);
      return reply.status(200).send({ data: history, total: history.length });
    }
  );

  app.post(
    "/admin/imports/locations/preview",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded", error_code: "missing_file" });
      }

      const mime = data.mimetype;
      const filename = data.filename ?? "";
      if (!isXlsxUpload(mime, filename)) {
        return badFileReply(reply, filename, mime);
      }

      const buffer = await data.toBuffer();
      try {
        const preview = await buildImportPreview(filename, buffer);
        return reply.status(200).send({ data: preview });
      } catch (error) {
        if (error instanceof Error && error.message === "empty_workbook") {
          return reply.status(400).send({ error: "XLSX file has no sheets", error_code: "empty_workbook" });
        }
        if (error instanceof Error && error.message === "empty_sheet") {
          return reply.status(400).send({ error: "Sheet has no data rows", error_code: "empty_sheet" });
        }
        if (error instanceof Error && error.message === "row_limit_exceeded") {
          return reply.status(400).send({ error: `Sheet exceeds ${IMPORT_ROW_LIMIT} rows`, error_code: "row_limit_exceeded" });
        }
        return reply.status(400).send({ error: "Failed to parse XLSX file", error_code: "parse_error" });
      }
    }
  );

  app.post(
    "/admin/imports/locations/commit",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const filename = typeof body.filename === "string" ? body.filename : null;
      const upsert = body.upsert === true;
      const entriesRaw = Array.isArray(body.entries) ? body.entries : null;

      if (!entriesRaw || entriesRaw.length === 0) {
        return reply.status(400).send({ error: "No entries to import", error_code: "missing_entries" });
      }
      if (entriesRaw.length > IMPORT_ROW_LIMIT) {
        return reply.status(400).send({ error: `Entries exceed ${IMPORT_ROW_LIMIT}`, error_code: "row_limit_exceeded" });
      }

      const entries: DiscoveryPlaceEntry[] = [];
      const rowValidationErrors: ImportRowError[] = [];
      for (let index = 0; index < entriesRaw.length; index++) {
        const result = validateDiscoveryPlaceEntry(entriesRaw[index] as Record<string, unknown>, index + 1);
        if ("error" in result) {
          rowValidationErrors.push({ row: index + 1, reason: result.error });
        } else {
          entries.push(result.entry);
        }
      }

      if (entries.length === 0) {
        return reply.status(422).send({
          error: "All rows failed validation",
          error_code: "all_rows_invalid",
          row_errors: rowValidationErrors,
        });
      }

      let result;
      try {
        result = await upsertDiscoveryPlaces(entries, getAuthUser(request).id, upsert);
      } catch (error) {
        if (isDiscoveryPlacesCatalogMissing(error)) {
          return reply.status(503).send({
            error: "El catálogo de lugares no está inicializado en esta base.",
            error_code: "catalog_unavailable",
          });
        }
        throw error;
      }
      await writeImportAuditLog(request, {
        filename,
        row_count: entriesRaw.length,
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        invalid_count: rowValidationErrors.length,
        duplicate_count: result.errors.filter((entry) => entry.reason.includes("duplicate")).length,
        upsert,
      });

      return reply.status(200).send({
        data: {
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          row_validation_errors: rowValidationErrors,
          upsert_errors: result.errors.filter((entry) => !entry.reason.includes("duplicate")),
          duplicate_keys: result.errors.filter((entry) => entry.reason.includes("duplicate")).map((entry) => entry.location_key),
        },
      });
    }
  );

  app.post(
    "/admin/discovery/places/import",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file uploaded", error_code: "missing_file" });
      }

      const authUser = getAuthUser(request);
      const upsert = (request.query as Record<string, string>)["upsert"] === "true";
      const mime = data.mimetype;
      const filename = data.filename ?? "";
      if (!isXlsxUpload(mime, filename)) {
        return badFileReply(reply, filename, mime);
      }

      const buffer = await data.toBuffer();
      try {
        const preview = await buildImportPreview(filename, buffer);
        if (preview.valid_count === 0) {
          return reply.status(422).send({
            error: "All rows failed validation",
            error_code: "all_rows_invalid",
            row_errors: preview.row_validation_errors,
          });
        }

        let result;
        try {
          result = await upsertDiscoveryPlaces(preview.entries, authUser.id, upsert);
        } catch (error) {
          if (isDiscoveryPlacesCatalogMissing(error)) {
            return reply.status(503).send({
              error: "El catálogo de lugares no está inicializado en esta base.",
              error_code: "catalog_unavailable",
            });
          }
          throw error;
        }
        await writeImportAuditLog(request, {
          filename,
          row_count: preview.row_count,
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          invalid_count: preview.invalid_count,
          duplicate_count: preview.duplicate_count,
          upsert,
        });

        return reply.status(200).send({
          data: {
            inserted: result.inserted,
            updated: result.updated,
            skipped: result.skipped,
            row_validation_errors: preview.row_validation_errors,
            upsert_errors: result.errors.filter((entry) => !entry.reason.includes("duplicate")),
            duplicate_keys: result.errors.filter((entry) => entry.reason.includes("duplicate")).map((entry) => entry.location_key),
          },
        });
      } catch (error) {
        if (error instanceof Error && error.message === "empty_workbook") {
          return reply.status(400).send({ error: "XLSX file has no sheets", error_code: "empty_workbook" });
        }
        if (error instanceof Error && error.message === "empty_sheet") {
          return reply.status(400).send({ error: "Sheet has no data rows", error_code: "empty_sheet" });
        }
        if (error instanceof Error && error.message === "row_limit_exceeded") {
          return reply.status(400).send({ error: `Sheet exceeds ${IMPORT_ROW_LIMIT} rows`, error_code: "row_limit_exceeded" });
        }
        return reply.status(400).send({ error: "Failed to parse XLSX file", error_code: "parse_error" });
      }
    }
  );
}
