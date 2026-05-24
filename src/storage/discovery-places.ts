import { getSupabase } from "../shared/supabase.js";

export type DiscoveryPlaceKind =
  | "departamento"
  | "ciudad"
  | "barrio"
  | "zona_turistica"
  | "polo_industrial"
  | "avenida";

export interface DiscoveryPlaceEntry {
  location_key: string;
  display_name: string;
  parent_location: string | null;
  kind: DiscoveryPlaceKind;
  lat_approx: number | null;
  lng_approx: number | null;
  commercial_score: number | null;
  notes: string | null;
}

export interface DiscoveryPlaceRecord extends DiscoveryPlaceEntry {
  id: string;
  source: string;
  imported_at: string;
  imported_by_user_id: string | null;
}

export interface UpsertDiscoveryPlacesResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ location_key: string; reason: string }>;
}

const VALID_KINDS = new Set<string>([
  "departamento",
  "ciudad",
  "barrio",
  "zona_turistica",
  "polo_industrial",
  "avenida",
]);

export function validateDiscoveryPlaceEntry(
  row: Partial<Record<string, unknown>>,
  rowIndex: number
): { entry: DiscoveryPlaceEntry } | { error: string } {
  const location_key = typeof row["location_key"] === "string" ? row["location_key"].trim() : null;
  const display_name = typeof row["display_name"] === "string" ? row["display_name"].trim() : null;
  const kind = typeof row["kind"] === "string" ? row["kind"].trim() : null;

  if (!location_key) return { error: `Row ${rowIndex}: missing location_key` };
  if (!display_name) return { error: `Row ${rowIndex}: missing display_name` };
  if (!kind || !VALID_KINDS.has(kind)) {
    return { error: `Row ${rowIndex}: invalid kind "${kind ?? ""}" — must be one of ${[...VALID_KINDS].join(", ")}` };
  }

  const latRaw = row["lat_approx"];
  const lngRaw = row["lng_approx"];
  const lat_approx = latRaw != null && latRaw !== "" ? Number(latRaw) : null;
  const lng_approx = lngRaw != null && lngRaw !== "" ? Number(lngRaw) : null;

  if (lat_approx !== null && (isNaN(lat_approx) || lat_approx < -35 || lat_approx > -30)) {
    return { error: `Row ${rowIndex}: lat_approx ${lat_approx} out of Uruguay bounds (-35 to -30)` };
  }
  if (lng_approx !== null && (isNaN(lng_approx) || lng_approx < -58 || lng_approx > -53)) {
    return { error: `Row ${rowIndex}: lng_approx ${lng_approx} out of Uruguay bounds (-58 to -53)` };
  }

  const scoreRaw = row["commercial_score"];
  const commercial_score = scoreRaw != null && scoreRaw !== "" ? Number(scoreRaw) : null;
  if (commercial_score !== null && (isNaN(commercial_score) || commercial_score < 0 || commercial_score > 100)) {
    return { error: `Row ${rowIndex}: commercial_score ${commercial_score} must be 0-100` };
  }

  const parent_location = typeof row["parent_location"] === "string" && row["parent_location"].trim()
    ? row["parent_location"].trim()
    : null;
  const notes = typeof row["notes"] === "string" && row["notes"].trim()
    ? row["notes"].trim()
    : null;

  return {
    entry: {
      location_key,
      display_name,
      parent_location,
      kind: kind as DiscoveryPlaceKind,
      lat_approx: lat_approx !== null && !isNaN(lat_approx) ? lat_approx : null,
      lng_approx: lng_approx !== null && !isNaN(lng_approx) ? lng_approx : null,
      commercial_score: commercial_score !== null && !isNaN(commercial_score) ? Math.round(commercial_score) : null,
      notes,
    },
  };
}

export async function upsertDiscoveryPlaces(
  entries: DiscoveryPlaceEntry[],
  importedByUserId: string | null,
  upsertMode: boolean
): Promise<UpsertDiscoveryPlacesResult> {
  if (entries.length === 0) return { inserted: 0, updated: 0, skipped: 0, errors: [] };

  const db = getSupabase();

  const locationKeys = entries.map((e) => e.location_key);
  const { data: existing, error: fetchErr } = await db
    .from("discovery_places_catalog")
    .select("location_key")
    .in("location_key", locationKeys);

  if (fetchErr) throw new Error(`Failed to check existing places: ${fetchErr.message}`);

  const existingKeys = new Set((existing ?? []).map((r: { location_key: string }) => r.location_key));

  const toInsert: DiscoveryPlaceEntry[] = [];
  const toUpdate: DiscoveryPlaceEntry[] = [];
  let skipped = 0;
  const errors: UpsertDiscoveryPlacesResult["errors"] = [];

  for (const entry of entries) {
    if (existingKeys.has(entry.location_key)) {
      if (upsertMode) {
        toUpdate.push(entry);
      } else {
        skipped++;
        errors.push({ location_key: entry.location_key, reason: "duplicate — use upsert=true to overwrite" });
      }
    } else {
      toInsert.push(entry);
    }
  }

  const now = new Date().toISOString();

  if (toInsert.length > 0) {
    const rows = toInsert.map((e) => ({
      ...e,
      source: "xls_import",
      imported_at: now,
      imported_by_user_id: importedByUserId,
    }));
    const { error } = await db.from("discovery_places_catalog").insert(rows);
    if (error) throw new Error(`Failed to insert discovery places: ${error.message}`);
  }

  for (const entry of toUpdate) {
    const { error } = await db
      .from("discovery_places_catalog")
      .update({
        display_name: entry.display_name,
        parent_location: entry.parent_location,
        kind: entry.kind,
        lat_approx: entry.lat_approx,
        lng_approx: entry.lng_approx,
        commercial_score: entry.commercial_score,
        notes: entry.notes,
        imported_at: now,
        imported_by_user_id: importedByUserId,
      })
      .eq("location_key", entry.location_key);
    if (error) {
      errors.push({ location_key: entry.location_key, reason: error.message });
    }
  }

  const updateErrors = errors.filter((e) => !e.reason.includes("duplicate"));

  return {
    inserted: toInsert.length,
    updated: toUpdate.length - updateErrors.length,
    skipped,
    errors,
  };
}

export async function listDiscoveryPlaces(params: {
  kind?: DiscoveryPlaceKind;
  parent_location?: string;
  q?: string;
  limit?: number;
}): Promise<DiscoveryPlaceRecord[]> {
  let query = getSupabase()
    .from("discovery_places_catalog")
    .select("*")
    .order("commercial_score", { ascending: false })
    .order("display_name");

  if (params.kind) query = query.eq("kind", params.kind);
  if (params.parent_location) query = query.eq("parent_location", params.parent_location);
  if (params.q) {
    const q = `%${params.q.toLowerCase()}%`;
    query = query.or(`display_name.ilike.${q},location_key.ilike.${q}`);
  }

  const { data, error } = await query.limit(params.limit ?? 500);
  if (error) throw new Error(`Failed to list discovery places: ${error.message}`);
  return (data ?? []) as DiscoveryPlaceRecord[];
}
