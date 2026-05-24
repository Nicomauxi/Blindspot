import { fetch, Agent } from "undici";
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";
import { normalizeNiche } from "../filters.js";
import { parseTipoOperador } from "../../enrichment/parsers/mintur-tipo-operador.js";

const SOURCE: DiscoverySource = "mintur";
const SOURCE_CONFIDENCE = 0.8;
const BASE_URL = "https://catalogodatos.gub.uy/api/3/action/datastore_search";
const RESOURCE_ID = "65df8141-f444-49bb-a66a-51c1c3b387df";
const PAGE_SIZE = 500;

export interface MINTURRecord {
  _id: number;
  Operador: string;
  Direccion: string;
  Departamento: string;
  Localidad: string;
  Web: string;
  Telefono: string;
  EMail: string;
  TipoOperador?: string;
}

interface CKANResponse {
  result: {
    total: number;
    records: MINTURRecord[];
  };
}

// rejectUnauthorized: false — catalogodatos.gub.uy tiene TLS intermitentemente frágil
const tlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

// Sentinel values MINTUR uses for missing data
const SENTINEL_VALUES = new Set(["S/D", "NO DECLARA", "PENDIENTE", "S/N"]);

export function isBlank(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length === 0 || SENTINEL_VALUES.has(trimmed);
}

export function parsePhone(telefono: string): string | null {
  if (isBlank(telefono)) return null;
  const tokens = telefono.split(/\s*[-,|]\s*/);
  const first = tokens.find((t) => !isBlank(t));
  return first?.trim() ?? null;
}

export function shouldDiscard(record: MINTURRecord): boolean {
  if (isBlank(record.Operador)) return true;
  const hasContact = !isBlank(record.EMail) || !isBlank(record.Telefono) || !isBlank(record.Web);
  return !hasContact;
}

export function inferNiche(record: MINTURRecord): string {
  const parsed = parseTipoOperador({ TipoOperador: record.TipoOperador });
  if (parsed && parsed.tipo_operador_sub_niche !== "otro_mintur") {
    const normalizedSubNiche = normalizeNiche(parsed.tipo_operador_sub_niche.replace(/_/g, " "));
    if (normalizedSubNiche !== "other") return normalizedSubNiche;
  }

  const normalizedRaw = normalizeNiche([record.TipoOperador, record.Operador].filter((value) => !isBlank(value)).join(" "));
  return normalizedRaw;
}

export function mapRecord(record: MINTURRecord): DiscoveryCandidate {
  const address = [record.Direccion, record.Localidad, record.Departamento]
    .filter((v) => !isBlank(v))
    .join(", ");
  return {
    source: SOURCE,
    external_id: String(record._id),
    source_confidence: SOURCE_CONFIDENCE,
    name: record.Operador,
    address: address || null,
    phone: parsePhone(record.Telefono),
    website: isBlank(record.Web) ? null : record.Web,
    email: isBlank(record.EMail) ? null : record.EMail,
    latitude: null,
    longitude: null,
    niche: inferNiche(record),
    raw: record as unknown as Record<string, unknown>,
  };
}

async function fetchPage(params: URLSearchParams): Promise<CKANResponse> {
  const url = `${BASE_URL}?${params}`;
  const response = await fetch(url, { dispatcher: tlsAgent });
  if (!response.ok) {
    throw new Error(`MINTUR API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<CKANResponse>;
}

async function fetchAllRecords(filters: string | null): Promise<MINTURRecord[]> {
  const records: MINTURRecord[] = [];
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

    if (records.length >= data.result.total) break;
    offset += PAGE_SIZE;
  }

  return records;
}

async function probeFilter(filters: string): Promise<number> {
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    limit: "1",
    filters,
  });
  const data = await fetchPage(params);
  return data.result.total;
}

export class MINTURProvider implements IDiscoveryProvider {
  readonly source = SOURCE;
  readonly sourceConfidence = SOURCE_CONFIDENCE;

  async discover(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const locationUpper = query.location.toUpperCase();

    const deptFilter = JSON.stringify({ Departamento: locationUpper });
    const deptTotal = await probeFilter(deptFilter);

    let records: MINTURRecord[];
    if (deptTotal > 0) {
      records = await fetchAllRecords(deptFilter);
    } else {
      const locFilter = JSON.stringify({ Localidad: locationUpper });
      const locTotal = await probeFilter(locFilter);

      if (locTotal > 0) {
        records = await fetchAllRecords(locFilter);
      } else {
        records = await fetchAllRecords(null);
      }
    }

    return records.filter((r) => !shouldDiscard(r)).map(mapRecord);
  }
}
