import { fetch, Agent } from "undici";
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";
import { normalizeNiche } from "../filters.js";

// Directorio de Empresas Industriales (DEI) del MIEM — dato abierto del Estado uruguayo
// (catalogodatos.gub.uy, licencia odc-uy que permite uso comercial y persistir). Registro
// oficial con RUT verificado → confianza alta. Aporta identidad fiscal + rubro CIIU + dirección
// + contacto a escala nacional. NOTA: el GPS del DEI es ruidoso (probado: coords a cientos de km
// de la dirección real) → NO se usa; lat/lng quedan null y el pipeline geocodifica desde la
// dirección textual, que sí es buena.
const SOURCE: DiscoverySource = "miem_dei";
const SOURCE_CONFIDENCE = 0.9;
const BASE_URL = "https://catalogodatos.gub.uy/api/3/action/datastore_search";
const RESOURCE_ID = "e56d1949-3e94-42a9-801f-c6d2523b185d";
const PAGE_SIZE = 500;
const COL_DEPARTMENT = "Departamento (EP)";
const COL_STATE = "Estado de la empresa";
const STATE_APPROVED = "Aprobado";

export interface DEIRecord {
  _id: number;
  "Estado de la empresa": string;
  RUT: string;
  "Denominacion Social": string;
  "Nombre comercial": string;
  "Descripcion de la Actividad": string;
  "Codigo CIIU principal": string;
  "Descripcion Codigo CIIU principal": string;
  "Calle (EP)": string;
  "Numero (EP)": string;
  "Localidad (EP)": string;
  "Departamento (EP)": string;
  "Codigo Postal (EP)": string;
  "Email publico": string;
  "Sitio web": string;
  "Numero de telefono": string;
}

interface CKANResponse {
  result: {
    total: number;
    records: DEIRecord[];
  };
}

const tlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

// El DEI marca dato faltante como "S/D" (y a veces vacío / "S/N").
const SENTINEL_VALUES = new Set(["S/D", "S/N", "NO DECLARA", "PENDIENTE"]);

// El datastore CKAN puede devolver un campo como number (ej. teléfono/RUT) o string según
// cómo infirió el tipo de la columna → todo acceso se normaliza a string primero.
function asStr(value: unknown): string {
  return value == null ? "" : String(value);
}

export function isBlank(value: unknown): boolean {
  const trimmed = asStr(value).trim().toUpperCase();
  return trimmed.length === 0 || SENTINEL_VALUES.has(trimmed);
}

export function parsePhone(telefono: unknown): string | null {
  if (isBlank(telefono)) return null;
  const tokens = asStr(telefono).split(/\s*[-,/|]\s*/);
  const first = tokens.find((t) => !isBlank(t));
  return first?.trim() ?? null;
}

// Descarta filas no aprobadas o sin ninguna razón social/nombre. NO exige contacto: el RUT +
// rubro + dirección ya aportan al discovery y el contacto se completa luego en el enrichment.
export function shouldDiscard(record: DEIRecord): boolean {
  if (asStr(record[COL_STATE]).trim() !== STATE_APPROVED) return true;
  return isBlank(record["Nombre comercial"]) && isBlank(record["Denominacion Social"]);
}

export function inferNiche(record: DEIRecord): string {
  const parts = [record["Descripcion Codigo CIIU principal"], record["Descripcion de la Actividad"]]
    .filter((v) => !isBlank(v))
    .map(asStr)
    .join(" ");
  return normalizeNiche(parts);
}

function buildAddress(record: DEIRecord): string | null {
  const street = [record["Calle (EP)"], record["Numero (EP)"]].filter((v) => !isBlank(v)).map(asStr).join(" ").trim();
  const parts = [street, asStr(record["Localidad (EP)"]), asStr(record["Departamento (EP)"])].filter((v) => v && !isBlank(v));
  return parts.length > 0 ? parts.join(", ") : null;
}

export function mapRecord(record: DEIRecord): DiscoveryCandidate {
  const name = isBlank(record["Nombre comercial"])
    ? asStr(record["Denominacion Social"]).trim()
    : asStr(record["Nombre comercial"]).trim();
  return {
    source: SOURCE,
    external_id: asStr(record.RUT),
    source_confidence: SOURCE_CONFIDENCE,
    name,
    address: buildAddress(record),
    phone: parsePhone(record["Numero de telefono"]),
    website: isBlank(record["Sitio web"]) ? null : asStr(record["Sitio web"]).trim(),
    email: isBlank(record["Email publico"]) ? null : asStr(record["Email publico"]).trim(),
    // GPS del DEI descartado por ruidoso → el pipeline geocodifica desde la dirección.
    latitude: null,
    longitude: null,
    niche: inferNiche(record),
    // Texto crudo de rubro para que la capa normalizadora común reclasifique con el
    // vocabulario dinámico (descripción CIIU + actividad declarada).
    niche_hint: [record["Descripcion Codigo CIIU principal"], record["Descripcion de la Actividad"]]
      .filter((v) => !isBlank(v))
      .map(asStr)
      .join(" "),
    raw: record as unknown as Record<string, unknown>,
  };
}

async function fetchPage(params: URLSearchParams): Promise<CKANResponse> {
  const url = `${BASE_URL}?${params}`;
  const response = await fetch(url, { dispatcher: tlsAgent });
  if (!response.ok) {
    throw new Error(`DEI API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<CKANResponse>;
}

async function fetchAllRecords(filters: string | null): Promise<DEIRecord[]> {
  const records: DEIRecord[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      resource_id: RESOURCE_ID,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (filters !== null) params.set("filters", filters);

    const data = await fetchPage(params);
    records.push(...data.result.records);

    if (records.length >= data.result.total || data.result.records.length === 0) break;
    offset += PAGE_SIZE;
  }

  return records;
}

async function probeFilter(filters: string): Promise<number> {
  const params = new URLSearchParams({ resource_id: RESOURCE_ID, limit: "1", filters });
  const data = await fetchPage(params);
  return data.result.total;
}

export class DEIProvider implements IDiscoveryProvider {
  readonly source = SOURCE;
  readonly sourceConfidence = SOURCE_CONFIDENCE;

  // Patrón MINTUR: filtra por departamento (location) en el datastore; el niche de la query NO
  // filtra (el DEI indexa por CIIU code, no por nuestro niche) — se devuelve todo el padrón del
  // departamento con niche inferido del CIIU, y el pipeline asigna/filtra después. location vacío
  // o "uruguay"/"todos" → padrón nacional completo.
  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const loc = query.location.trim().toUpperCase();
    const nationwide = loc === "" || loc === "URUGUAY" || loc === "TODOS" || loc === "*";

    let records: DEIRecord[];
    if (nationwide) {
      records = await fetchAllRecords(null);
    } else {
      const deptFilter = JSON.stringify({ [COL_DEPARTMENT]: loc });
      const deptTotal = await probeFilter(deptFilter);
      records = deptTotal > 0 ? await fetchAllRecords(deptFilter) : await fetchAllRecords(null);
    }

    return records.filter((r) => !shouldDiscard(r)).map(mapRecord);
  }
}
