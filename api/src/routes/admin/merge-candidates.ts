import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, getAuthUser } from "../../auth/middleware.js";
import { getDb } from "../../db/client.js";
import { reconcileLeadIntoPrimary } from "../../../../src/storage/reconciliation.js";

const idParamSchema = z.object({ id: z.string().uuid() });

interface MergeCandidateRow {
  id: string;
  primary_lead_id: string;
  secondary_lead_id: string;
  match_kind: string;
  match_key: string;
  same_city: boolean;
  name_similarity: number;
  reason: string;
  status: string;
  created_at: string;
}

interface LeadSummary {
  id: string;
  name: string;
  source: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  niche: string | null;
  prospect_score: number | null;
}

export async function mergeCandidatesRoutes(app: FastifyInstance): Promise<void> {
  // Lista de candidatos pendientes con el resumen de ambos leads para revisión humana.
  app.get("/admin/merge-candidates", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data: candidates, error } = await db
      .from("lead_merge_candidates")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      request.log.error({ err: error }, "Failed to list merge candidates");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = (candidates ?? []) as MergeCandidateRow[];
    const leadIds = Array.from(new Set(rows.flatMap((r) => [r.primary_lead_id, r.secondary_lead_id])));

    const leadsById = new Map<string, LeadSummary>();
    if (leadIds.length > 0) {
      const { data: leads, error: leadsError } = await db
        .from("leads")
        .select("id, name, source, address, phone, website, niche, prospect_score")
        .in("id", leadIds);
      if (leadsError) {
        request.log.error({ err: leadsError }, "Failed to load leads for merge candidates");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }
      for (const lead of (leads ?? []) as LeadSummary[]) leadsById.set(lead.id, lead);
    }

    const data = rows
      // Defensivo: omitir candidatos cuyos leads ya no existen (absorbidos por otra unión).
      .filter((r) => leadsById.has(r.primary_lead_id) && leadsById.has(r.secondary_lead_id))
      .map((r) => ({
        id: r.id,
        match_kind: r.match_kind,
        match_key: r.match_key,
        same_city: r.same_city,
        name_similarity: r.name_similarity,
        reason: r.reason,
        created_at: r.created_at,
        primary: leadsById.get(r.primary_lead_id)!,
        secondary: leadsById.get(r.secondary_lead_id)!,
      }));

    return reply.status(200).send({ data, meta: { total: data.length } });
  });

  // Aprobar: fusiona el secundario en el primario y marca el candidato como approved.
  app.post("/admin/merge-candidates/:id/approve", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid id", error_code: "invalid_id" });

    const db = getDb();
    const { data: candidate, error } = await db
      .from("lead_merge_candidates")
      .select("*")
      .eq("id", parsed.data.id)
      .eq("status", "pending")
      .single();

    if (error || !candidate) {
      return reply.status(404).send({ error: "Candidate not found or already resolved", error_code: "not_found" });
    }

    const row = candidate as MergeCandidateRow;
    try {
      await reconcileLeadIntoPrimary(row.primary_lead_id, row.secondary_lead_id);
    } catch (err) {
      request.log.error({ err, id: row.id }, "Merge candidate approve: reconcile failed");
      return reply.status(500).send({ error: "Merge failed", error_code: "merge_failed" });
    }

    const resolvedBy = getAuthUser(request).email ?? "admin";
    const { error: updErr } = await db
      .from("lead_merge_candidates")
      .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
      .eq("id", row.id);
    if (updErr) {
      request.log.error({ err: updErr, id: row.id }, "Merge approved but status update failed");
      // El merge ya se aplicó; informamos éxito parcial.
    }

    return reply.status(200).send({ data: { id: row.id, status: "approved", primary_lead_id: row.primary_lead_id } });
  });

  // Rechazar: marca como rejected sin tocar los leads.
  app.post("/admin/merge-candidates/:id/reject", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid id", error_code: "invalid_id" });

    const db = getDb();
    const resolvedBy = getAuthUser(request).email ?? "admin";
    const { data, error } = await db
      .from("lead_merge_candidates")
      .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
      .eq("id", parsed.data.id)
      .eq("status", "pending")
      .select("id")
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: "Candidate not found or already resolved", error_code: "not_found" });
    }

    return reply.status(200).send({ data: { id: parsed.data.id, status: "rejected" } });
  });
}
