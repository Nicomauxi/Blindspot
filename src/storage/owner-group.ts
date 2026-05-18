import { randomUUID } from "crypto";
import { getSupabase } from "../shared/supabase.js";

interface LeadRow {
  id: string;
  canonical_fields: Record<string, unknown> | null;
  owner_group_id: string | null;
}

export interface OwnerGroupResult {
  groups_created: number;
  leads_assigned: number;
}

function canonicalPhone(fields: Record<string, unknown> | null): string | null {
  if (!fields) return null;
  const raw = fields["phone"];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof (raw as Record<string, unknown>)["value"] === "string") {
    return (raw as Record<string, unknown>)["value"] as string;
  }
  return null;
}

function canonicalEmail(fields: Record<string, unknown> | null): string | null {
  if (!fields) return null;
  const raw = fields["email"];
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "value" in raw && typeof (raw as Record<string, unknown>)["value"] === "string") {
    return (raw as Record<string, unknown>)["value"] as string;
  }
  return null;
}

export async function detectOwnerGroups(): Promise<OwnerGroupResult> {
  const db = getSupabase();

  const { data, error } = await db
    .from("leads")
    .select("id, canonical_fields, owner_group_id")
    .not("canonical_fields", "is", null);

  if (error || !data) return { groups_created: 0, leads_assigned: 0 };

  const leads = data as LeadRow[];

  // Build index: signal → list of leads
  const phoneIndex = new Map<string, LeadRow[]>();
  const emailIndex = new Map<string, LeadRow[]>();

  for (const lead of leads) {
    const phone = canonicalPhone(lead.canonical_fields);
    if (phone) {
      const bucket = phoneIndex.get(phone) ?? [];
      bucket.push(lead);
      phoneIndex.set(phone, bucket);
    }
    const email = canonicalEmail(lead.canonical_fields);
    if (email) {
      const bucket = emailIndex.get(email) ?? [];
      bucket.push(lead);
      emailIndex.set(email, bucket);
    }
  }

  // Assign groups: for each bucket with 2+ leads, pick or create a group UUID
  // Track which leads need updates
  const toUpdate = new Map<string, string>(); // lead_id → group_uuid

  function assignGroup(bucket: LeadRow[]): void {
    if (bucket.length < 2) return;
    const existing = bucket.find((l) => l.owner_group_id)?.owner_group_id ?? randomUUID();
    for (const lead of bucket) {
      if (!lead.owner_group_id) {
        toUpdate.set(lead.id, existing);
      }
    }
  }

  for (const bucket of phoneIndex.values()) assignGroup(bucket);
  for (const bucket of emailIndex.values()) assignGroup(bucket);

  if (toUpdate.size === 0) return { groups_created: 0, leads_assigned: 0 };

  // Group by target group_uuid to issue fewer UPDATE calls
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
