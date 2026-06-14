import { randomUUID } from "crypto";
import { getSupabase } from "../shared/supabase.js";
import { classifyUruguayPhone } from "../shared/phone.js";

interface LeadRow {
  id: string;
  canonical_fields: Record<string, unknown> | null;
  owner_group_id: string | null;
  phone: string | null;
}

export interface OwnerGroupResult {
  groups_created: number;
  leads_assigned: number;
}

const PAGE_SIZE = 1000;

// Una señal compartida por más de este número de leads se considera genérica
// (móvil de agencia/gestor) y NO funda un grupo de dueño. F1.1.
const GENERIC_SIGNAL_THRESHOLD = 5;

function canonicalPhone(fields: Record<string, unknown> | null): string | null {
  if (!fields) return null;
  const raw = fields["phone"];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof (raw as Record<string, unknown>)["value"] === "string") {
    return (raw as Record<string, unknown>)["value"] as string;
  }
  return null;
}

/**
 * Clave de dueño: SOLO el móvil propio normalizado es señal fuerte (F1.1).
 * Fijos (gestor/oficina), teléfonos basura y emails (gestor/contador) se comparten
 * entre negocios ajenos y producían sobre-fusión, así que NO fundan grupo por sí solos.
 * Se prioriza el móvil de `canonical_fields`; si falta, se usa la columna `phone`
 * (la mayoría de los leads —p.ej. DEI— guardan el teléfono ahí, no en canonical_fields).
 */
function ownerKey(lead: LeadRow): string | null {
  const candidate = canonicalPhone(lead.canonical_fields) ?? lead.phone;
  if (!candidate) return null;
  const classified = classifyUruguayPhone(candidate);
  if (classified.type !== "mobile" || !classified.normalized) return null;
  return classified.normalized;
}

async function loadEnrichedLeads(db: ReturnType<typeof getSupabase>): Promise<LeadRow[]> {
  const leads: LeadRow[] = [];
  // Paginar para superar el max_rows (1000) de PostgREST — antes procesaba <45%. N8.1.
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .from("leads")
      .select("id, canonical_fields, owner_group_id, phone")
      .not("canonical_fields", "is", null)
      .range(from, to);

    if (error) throw new Error(`Failed to load leads for owner grouping: ${error.message}`);

    const batch = (data ?? []) as LeadRow[];
    leads.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return leads;
}

export async function detectOwnerGroups(): Promise<OwnerGroupResult> {
  const db = getSupabase();
  const leads = await loadEnrichedLeads(db);

  // Index: señal fuerte (móvil propio) → leads que la comparten.
  const phoneIndex = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const key = ownerKey(lead);
    if (!key) continue;
    const bucket = phoneIndex.get(key) ?? [];
    bucket.push(lead);
    phoneIndex.set(key, bucket);
  }

  // Asignar grupos: bucket con 2+ leads y por debajo del umbral genérico.
  const toUpdate = new Map<string, string>(); // lead_id → group_uuid

  function assignGroup(bucket: LeadRow[]): void {
    if (bucket.length < 2) return;
    if (bucket.length > GENERIC_SIGNAL_THRESHOLD) return; // móvil de agencia/gestor
    const existing = bucket.find((l) => l.owner_group_id)?.owner_group_id ?? randomUUID();
    for (const lead of bucket) {
      if (!lead.owner_group_id) {
        toUpdate.set(lead.id, existing);
      }
    }
  }

  for (const bucket of phoneIndex.values()) assignGroup(bucket);

  if (toUpdate.size === 0) return { groups_created: 0, leads_assigned: 0 };

  // Agrupar por group_uuid destino para emitir menos UPDATEs.
  const byGroup = new Map<string, string[]>();
  for (const [leadId, groupId] of toUpdate) {
    const bucket = byGroup.get(groupId) ?? [];
    bucket.push(leadId);
    byGroup.set(groupId, bucket);
  }

  let groupsCreated = 0;
  let leadsAssigned = 0;

  for (const [groupId, leadIds] of byGroup) {
    const isNew = !leads.some((l) => l.owner_group_id === groupId);
    await db.from("leads").update({ owner_group_id: groupId }).in("id", leadIds);
    if (isNew) groupsCreated++;
    leadsAssigned += leadIds.length;
  }

  return { groups_created: groupsCreated, leads_assigned: leadsAssigned };
}
