import { fetch, Agent } from "undici";
import type {
  IDiscoveryProvider,
  DiscoverySource,
  DiscoveryQuery,
  DiscoveryCandidate,
} from "../../../shared/types.js";

const SOURCE: DiscoverySource = "mintur";
const SOURCE_CONFIDENCE = 0.8;
const BASE_URL = "https://catalogodatos.gub.uy/api/3/action/datastore_search";
const RESOURCE_ID = "eb614f27-36d8-4a34-8bbf-ed5c40473df0";
const PAGE_SIZE = 500;

export interface MINTURRecord {
  _id: number;
  Operador: string;
  Direccion: string;
  Departamento: string;
  Localidad: string;
  Web: string;
  Telefono: string;
  Email: string;
}

interface CKANResponse {
  result: {
    total: number;
    records: MINTURRecord[];
  };
}

// rejectUnauthorized: false — catalogodatos.gub.uy tiene TLS intermitentemente frágil
const tlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

export function parsePhone(telefono: string): string | null {
  if (!telefono?.trim()) return null;
  const tokens = telefono.split(/\s*[-,|]\s*/);
  const first = tokens.find((t) => t.trim().length > 0);
  return first?.trim() ?? null;
}

export function shouldDiscard(record: MINTURRecord): boolean {
  if (!record.Operador?.trim()) return true;
  if (!record.Email && !record.Telefono && !record.Web) return true;
  return false;
}

export function mapRecord(record: MINTURRecord): DiscoveryCandidate {
  const address = [record.Direccion, record.Localidad, record.Departamento]
    .filter(Boolean)
    .join(", ");
  return {
    source: SOURCE,
    external_id: String(record._id),
    source_confidence: SOURCE_CONFIDENCE,
    name: record.Operador,
    address,
    phone: parsePhone(record.Telefono),
    website: record.Web || null,
    email: record.Email || null,
    latitude: null,
    longitude: null,
    niche: "other",
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
