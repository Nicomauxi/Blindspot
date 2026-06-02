import { getSupabase } from "../src/shared/supabase.js";
import type { DiscoveryPlaceEntry } from "../src/storage/discovery-places.js";

const SOURCE_SYSTEM = "uruguay_enrichment_seed_20260601";

type AliasGroup = { canonical: string; aliases: string[] };
type MappingRow = {
  niche: string;
  term: string;
  mapping_type: "niche_alias" | "directory_category";
  target_value: string | null;
  match_type: "contains" | "exact";
};

const NICHE_ALIAS_GROUPS: AliasGroup[] = [
  { canonical: "restaurant", aliases: ["restaurante", "parrilla", "pizzeria", "rotiseria", "chiviteria", "cafeteria", "cafe"] },
  { canonical: "hairdresser", aliases: ["peluqueria", "barberia", "barber shop", "salon capilar"] },
  { canonical: "gym", aliases: ["gimnasio", "fitness", "crossfit", "pilates"] },
  { canonical: "healthcare", aliases: ["clinica", "centro medico", "sanatorio", "policlinica", "mutualista"] },
  { canonical: "dentist", aliases: ["dentista", "odontologo", "odontologia", "consultorio odontologico"] },
  { canonical: "accommodation", aliases: ["hotel", "hostel", "hospedaje", "posada", "apart hotel", "alojamiento"] },
  { canonical: "pharmacy", aliases: ["farmacia", "botica"] },
  { canonical: "grocery", aliases: ["supermercado", "almacen", "autoservicio", "minimercado"] },
  { canonical: "car_dealer", aliases: ["automotora", "concesionaria", "venta de autos", "usados", "0km"] },
  { canonical: "bakery", aliases: ["panaderia", "confiteria", "pasteleria", "bakery"] },
  { canonical: "veterinary", aliases: ["veterinaria", "veterinario", "veterinary"] },
  { canonical: "hardware_store", aliases: ["ferreteria", "barraca", "pintureria", "hardware store"] },
  { canonical: "auto_repair", aliases: ["taller mecanico", "mecanico", "lubricentro", "gomeria", "auto repair"] },
  { canonical: "beauty", aliases: ["salon de belleza", "estetica", "cosmetica", "manicuria", "nails"] },
];

const DIRECTORY_CATEGORY_MAPPINGS: Array<{ niche: string; category: string | null }> = [
  { niche: "restaurant", category: "Restaurantes" },
  { niche: "hairdresser", category: "Peluqueros" },
  { niche: "gym", category: "Fitness" },
  { niche: "healthcare", category: "Médicos_y_Clínicos" },
  { niche: "dentist", category: "Dentistas" },
  { niche: "accommodation", category: "Hoteles" },
  { niche: "pharmacy", category: "Farmacias" },
  { niche: "grocery", category: "Supermercado" },
  { niche: "car_dealer", category: "Venta_de_Vehículos" },
  { niche: "bakery", category: "Panaderias" },
  { niche: "veterinary", category: "Veterinarios" },
  { niche: "hardware_store", category: "Ferreterias" },
  { niche: "auto_repair", category: null },
  { niche: "beauty", category: null },
];

const DISCOVERY_PLACES: DiscoveryPlaceEntry[] = [
  { location_key: "artigas", display_name: "Artigas", parent_location: "uruguay", kind: "departamento", lat_approx: -30.41, lng_approx: -56.47, commercial_score: 60, notes: "Seed Uruguay 2026-06-01 | Departamento frontera norte." },
  { location_key: "durazno", display_name: "Durazno", parent_location: "uruguay", kind: "departamento", lat_approx: -33.38, lng_approx: -56.52, commercial_score: 64, notes: "Seed Uruguay 2026-06-01 | Departamento nodo centro del país." },
  { location_key: "flores", display_name: "Flores", parent_location: "uruguay", kind: "departamento", lat_approx: -33.54, lng_approx: -56.89, commercial_score: 55, notes: "Seed Uruguay 2026-06-01 | Departamento con cabecera operativa Trinidad." },
  { location_key: "lavalleja", display_name: "Lavalleja", parent_location: "uruguay", kind: "departamento", lat_approx: -34.37, lng_approx: -55.24, commercial_score: 61, notes: "Seed Uruguay 2026-06-01 | Departamento serrano con base comercial en Minas." },
  { location_key: "soriano", display_name: "Soriano", parent_location: "uruguay", kind: "departamento", lat_approx: -33.25, lng_approx: -58.03, commercial_score: 62, notes: "Seed Uruguay 2026-06-01 | Departamento litoral con cabecera en Mercedes." },
  { location_key: "tacuarembo", display_name: "Tacuarembó", parent_location: "uruguay", kind: "departamento", lat_approx: -31.72, lng_approx: -55.98, commercial_score: 63, notes: "Seed Uruguay 2026-06-01 | Departamento norte con actividad comercial regional." },
  { location_key: "treinta-y-tres", display_name: "Treinta y Tres", parent_location: "uruguay", kind: "departamento", lat_approx: -33.23, lng_approx: -54.38, commercial_score: 58, notes: "Seed Uruguay 2026-06-01 | Departamento este interior." },
  { location_key: "artigas-ciudad", display_name: "Artigas (Ciudad)", parent_location: "artigas", kind: "ciudad", lat_approx: -30.40, lng_approx: -56.47, commercial_score: 68, notes: "Seed Uruguay 2026-06-01 | Capital departamental y comercio de frontera." },
  { location_key: "durazno-ciudad", display_name: "Durazno (Ciudad)", parent_location: "durazno", kind: "ciudad", lat_approx: -33.38, lng_approx: -56.52, commercial_score: 70, notes: "Seed Uruguay 2026-06-01 | Capital departamental y nodo logístico." },
  { location_key: "trinidad", display_name: "Trinidad", parent_location: "flores", kind: "ciudad", lat_approx: -33.54, lng_approx: -56.89, commercial_score: 65, notes: "Seed Uruguay 2026-06-01 | Capital departamental de Flores." },
  { location_key: "minas", display_name: "Minas", parent_location: "lavalleja", kind: "ciudad", lat_approx: -34.37, lng_approx: -55.24, commercial_score: 69, notes: "Seed Uruguay 2026-06-01 | Capital departamental con servicios y turismo serrano." },
  { location_key: "mercedes", display_name: "Mercedes", parent_location: "soriano", kind: "ciudad", lat_approx: -33.25, lng_approx: -58.03, commercial_score: 71, notes: "Seed Uruguay 2026-06-01 | Capital departamental del litoral." },
  { location_key: "tacuarembo-ciudad", display_name: "Tacuarembó (Ciudad)", parent_location: "tacuarembo", kind: "ciudad", lat_approx: -31.72, lng_approx: -55.98, commercial_score: 70, notes: "Seed Uruguay 2026-06-01 | Capital departamental del norte interior." },
  { location_key: "treinta-y-tres-ciudad", display_name: "Treinta y Tres (Ciudad)", parent_location: "treinta-y-tres", kind: "ciudad", lat_approx: -33.23, lng_approx: -54.38, commercial_score: 66, notes: "Seed Uruguay 2026-06-01 | Capital departamental del este interior." },
  { location_key: "melo", display_name: "Melo", parent_location: "cerro-largo", kind: "ciudad", lat_approx: -32.37, lng_approx: -54.17, commercial_score: 69, notes: "Seed Uruguay 2026-06-01 | Capital departamental de Cerro Largo." },
  { location_key: "san-jose-de-mayo", display_name: "San José de Mayo", parent_location: "san-jose", kind: "ciudad", lat_approx: -34.34, lng_approx: -56.71, commercial_score: 69, notes: "Seed Uruguay 2026-06-01 | Capital departamental y polo de servicios." },
  { location_key: "canelones-ciudad", display_name: "Canelones (Ciudad)", parent_location: "canelones", kind: "ciudad", lat_approx: -34.52, lng_approx: -56.28, commercial_score: 64, notes: "Seed Uruguay 2026-06-01 | Capital departamental de Canelones." },
  { location_key: "la-paz", display_name: "La Paz", parent_location: "canelones", kind: "ciudad", lat_approx: -34.76, lng_approx: -56.22, commercial_score: 63, notes: "Seed Uruguay 2026-06-01 | Ciudad metropolitana del corredor canario." },
  { location_key: "salinas", display_name: "Salinas", parent_location: "canelones", kind: "ciudad", lat_approx: -34.79, lng_approx: -55.83, commercial_score: 66, notes: "Seed Uruguay 2026-06-01 | Balneario metropolitano de servicios y temporada." },
  { location_key: "atlantida", display_name: "Atlántida", parent_location: "canelones", kind: "ciudad", lat_approx: -34.77, lng_approx: -55.76, commercial_score: 72, notes: "Seed Uruguay 2026-06-01 | Polo costero con comercio y turismo de cercanía." },
  { location_key: "la-paloma", display_name: "La Paloma", parent_location: "rocha", kind: "ciudad", lat_approx: -34.66, lng_approx: -54.15, commercial_score: 74, notes: "Seed Uruguay 2026-06-01 | Balneario con densidad gastronómica y turística." },
  { location_key: "la-pedrera", display_name: "La Pedrera", parent_location: "rocha", kind: "zona_turistica", lat_approx: -34.59, lng_approx: -54.12, commercial_score: 76, notes: "Seed Uruguay 2026-06-01 | Zona turística de temporada alta." },
  { location_key: "pan-de-azucar", display_name: "Pan de Azúcar", parent_location: "maldonado", kind: "ciudad", lat_approx: -34.78, lng_approx: -55.24, commercial_score: 61, notes: "Seed Uruguay 2026-06-01 | Ciudad interior de Maldonado." },
  { location_key: "termas-del-arapey", display_name: "Termas del Arapey", parent_location: "salto", kind: "zona_turistica", lat_approx: -30.95, lng_approx: -57.53, commercial_score: 73, notes: "Seed Uruguay 2026-06-01 | Circuito termal del norte." },
];

function buildMappings(): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const group of NICHE_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      rows.push({
        niche: group.canonical,
        term: alias,
        mapping_type: "niche_alias",
        target_value: null,
        match_type: alias.includes(" ") ? "contains" : "contains",
      });
    }
  }
  for (const mapping of DIRECTORY_CATEGORY_MAPPINGS) {
    rows.push({
      niche: mapping.niche,
      term: mapping.niche,
      mapping_type: "directory_category",
      target_value: mapping.category,
      match_type: "exact",
    });
  }
  return rows;
}

async function upsertAliasGroups() {
  const db = getSupabase();
  const { data: existing } = await db.from("niche_aliases").select("canonical");
  const existingCanonicals = new Set((existing ?? []).map((row: { canonical: string }) => row.canonical));

  const payload = NICHE_ALIAS_GROUPS.map((group) => ({
    canonical: group.canonical,
    aliases: group.aliases,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db.from("niche_aliases").upsert(payload, { onConflict: "canonical" });
  if (error) throw new Error(`niche_aliases upsert failed: ${error.message}`);

  let inserted = 0;
  let updated = 0;
  for (const group of NICHE_ALIAS_GROUPS) {
    if (existingCanonicals.has(group.canonical)) updated++;
    else inserted++;
  }
  return { inserted, updated };
}

async function upsertMappings() {
  const db = getSupabase();
  const seedRows = buildMappings();
  const { data: existing } = await db.from("niche_mappings").select("niche, term, mapping_type");
  const existingKeys = new Set((existing ?? []).map((row: { niche: string; term: string; mapping_type: string }) => `${row.niche}::${row.term}::${row.mapping_type}`));

  const payload = seedRows.map((row) => ({
    ...row,
    source_system: SOURCE_SYSTEM,
    language: "es",
    enabled: true,
  }));

  const { error } = await db.from("niche_mappings").upsert(payload, { onConflict: "niche,term,mapping_type" });
  if (error) throw new Error(`niche_mappings upsert failed: ${error.message}`);

  let inserted = 0;
  let updated = 0;
  for (const row of seedRows) {
    const key = `${row.niche}::${row.term}::${row.mapping_type}`;
    if (existingKeys.has(key)) updated++;
    else inserted++;
  }
  return { inserted, updated };
}

async function upsertDiscoveryPlaces() {
  const db = getSupabase();
  const { data: existing } = await db.from("discovery_places_catalog").select("location_key");
  const existingKeys = new Set((existing ?? []).map((row: { location_key: string }) => row.location_key));

  const payload = DISCOVERY_PLACES.map((place) => ({
    ...place,
    source: SOURCE_SYSTEM,
    imported_at: new Date().toISOString(),
    imported_by_user_id: null,
  }));

  const { error } = await db.from("discovery_places_catalog").upsert(payload, { onConflict: "location_key" });
  if (error) throw new Error(`discovery_places_catalog upsert failed: ${error.message}`);

  let inserted = 0;
  let updated = 0;
  for (const place of DISCOVERY_PLACES) {
    if (existingKeys.has(place.location_key)) updated++;
    else inserted++;
  }
  return { inserted, updated };
}

async function main() {
  const aliasGroups = await upsertAliasGroups();
  const mappings = await upsertMappings();
  const places = await upsertDiscoveryPlaces();

  console.log(JSON.stringify({ aliasGroups, mappings, places }, null, 2));
}

await main();
