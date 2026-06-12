import { passesLeadFilter } from "../services/lead-filter.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser, type AuthUser } from "../auth/middleware.js";
import { createLLMProvider } from "../llm/factory.js";
import type { LlmUsageLog } from "../llm/types.js";

// Permissive UUID regex (Zod v4 uuid() is RFC-strict; this matches any 8-4-4-4-12 hex)
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const OUTREACH_STATUSES = [
  "contacted",
  "responded",
  "interested",
  "closed_won",
  "closed_lost",
  "no_response",
] as const;

const OUTCOMES = ["closed_won", "closed_lost", "not_now", "has_provider"] as const;
const LOST_REASONS = ["price", "timing", "no_interest", "competitor", "other"] as const;

const createSchema = z.object({
  lead_id: uuidSchema,
  campaign_id: uuidSchema.nullable().optional(),
  channel: z.string().min(1).max(100),
  offer_type: z.string().max(100).optional(),
  offer_package: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(OUTREACH_STATUSES).default("contacted"),
  responded: z.boolean().optional(),
  outcome: z.enum(OUTCOMES).nullable().optional(),
  lost_reason: z.enum(LOST_REASONS).nullable().optional(),
  service_sold: z.string().max(200).optional(),
  price_sold: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  contacted_at: z.string().datetime().optional(),
  responded_at: z.string().datetime().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
  lead_quality_signal: z.number().int().min(-10).max(10).default(0),
});

const patchSchema = createSchema
  .omit({ lead_id: true })
  .partial()
  .extend({
    lead_quality_signal: z.number().int().min(-10).max(10).optional(),
  });

const listQuerySchema = z.object({
  lead_id: uuidSchema.optional(),
  campaign_id: uuidSchema.optional(),
  status: z.enum(OUTREACH_STATUSES).optional(),
  cursor: uuidSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

function validateStatusOutcome(
  status: string,
  outcome?: string | null,
  lost_reason?: string | null
): string | null {
  if (status === "closed_won") {
    if (outcome && outcome !== "closed_won") {
      return "outreach_status_outcome_mismatch";
    }
  } else if (status === "closed_lost") {
    if (outcome && outcome !== "closed_lost") {
      return "outreach_status_outcome_mismatch";
    }
  } else {
    // Non-closed statuses
    if (outcome === "closed_won" || outcome === "closed_lost") {
      return "outreach_status_outcome_mismatch";
    }
    if (lost_reason) {
      return "outreach_status_outcome_mismatch";
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}


async function getAdminServicePrice(
  db: ReturnType<typeof getDb>,
  serviceType: string
): Promise<number | null> {
  const { data, error } = await db
    .from("service_pricing")
    .select("monthly_fee, users!inner(role)")
    .eq("service_type", serviceType)
    .eq("users.role", "admin")
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return typeof (data as { monthly_fee?: unknown }).monthly_fee === "number"
    ? (data as { monthly_fee: number }).monthly_fee
    : null;
}

async function loadAuthorizedCampaign(
  db: ReturnType<typeof getDb>,
  campaignId: string,
  authUser: AuthUser
): Promise<{ ok: true; campaign: Record<string, unknown> } | { ok: false; status: number; error: string; error_code: string }> {
  const { data, error } = await db
    .from("outreach_campaigns")
    .select("id, user_id, status, closed_at")
    .eq("id", campaignId)
    .single();

  if (error || !data) {
    return { ok: false, status: 404, error: "Campaign not found", error_code: "campaign_not_found" };
  }

  if (authUser.role !== "admin" && (data as { user_id?: string }).user_id !== authUser.id) {
    return { ok: false, status: 404, error: "Campaign not found", error_code: "campaign_not_found" };
  }

  if ((data as { status?: string }).status !== "active") {
    return { ok: false, status: 409, error: "Campaign is not active", error_code: "campaign_inactive" };
  }

  return { ok: true, campaign: data as Record<string, unknown> };
}

export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/outreach — list outreach records
  app.get("/outreach", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parseResult = listQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        error_code: "invalid_query",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { lead_id, campaign_id, status, cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("lead_outreach")
      .select("*", { count: "exact" });

    // CM can only see their own records
    if (authUser.role === "cm") {
      query = query.eq("user_id", authUser.id);
    }

    if (lead_id) query = query.eq("lead_id", lead_id);
    if (campaign_id) query = query.eq("campaign_id", campaign_id);
    if (status) query = query.eq("status", status);

    if (cursor) {
      const { data: cursorRow } = await db
        .from("lead_outreach")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    query = query.order("created_at", { ascending: false }).limit(limit + 1);

    const { data, error, count } = await query;
    if (error) {
      request.log.error({ error }, "outreach list query error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null : null;

    return reply.status(200).send({
      data: page,
      next_cursor: nextCursor,
      total: count ?? 0,
    });
  });

  // POST /api/v1/outreach — create outreach record
  app.post("/outreach", { preHandler: requireAuth }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const parseResult = createSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const body = parseResult.data;

    const statusOutcomeError = validateStatusOutcome(
      body.status,
      body.outcome ?? null,
      body.lost_reason ?? null
    );
    if (statusOutcomeError) {
      return reply.status(400).send({
        error: "Status and outcome are inconsistent",
        error_code: statusOutcomeError,
      });
    }

    // Verify the lead exists and CM can access it
    const db = getDb();
    const { data: lead, error: leadError } = await db
      .from("lead_dashboard")
      .select("*")
      .eq("id", body.lead_id)
      .single();

    if (leadError || !lead) {
      return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
    }

    // CM filter check
    if (authUser.role === "cm") {
      if (!authUser.lead_filter) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
      if (!passesLeadFilter(lead as Record<string, unknown>, authUser.lead_filter)) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }
    }

    if (body.campaign_id) {
      const campaignCheck = await loadAuthorizedCampaign(db, body.campaign_id, authUser);
      if (!campaignCheck.ok) {
        return reply.status(campaignCheck.status).send({
          error: campaignCheck.error,
          error_code: campaignCheck.error_code,
        });
      }
    }

    const contactedAt = body.contacted_at ?? new Date().toISOString();

    const { data: row, error: insertError } = await db
      .from("lead_outreach")
      .insert({
        lead_id: body.lead_id,
        campaign_id: body.campaign_id ?? null,
        user_id: authUser.id,
        channel: body.channel,
        offer_type: body.offer_type ?? null,
        offer_package: body.offer_package ?? null,
        status: body.status,
        responded: body.responded ?? null,
        outcome: body.outcome ?? null,
        lost_reason: body.lost_reason ?? null,
        service_sold: body.service_sold ?? null,
        price_sold: body.price_sold ?? null,
        notes: body.notes ?? null,
        contacted_at: contactedAt,
        responded_at: body.responded_at ?? null,
        closed_at: body.closed_at ?? null,
        lead_quality_signal: body.lead_quality_signal,
      })
      .select()
      .single();

    if (insertError) {
      request.log.error({ error: insertError }, "outreach insert error");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    // Keep lead-level first-contact markers consistent without overwriting later history.
    await db
      .from("leads")
      .update({ contacted_by: authUser.id, contacted_at: contactedAt, state: "contacted" })
      .eq("id", body.lead_id)
      .is("contacted_by", null);

    return reply.status(201).send({ data: row });
  });

  // PATCH /api/v1/outreach/:id — update outreach record
  app.patch(
    "/outreach/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ) {
        return reply.status(404).send({ error: "Not found", error_code: "not_found" });
      }

      const parseResult = patchSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Validation error",
          error_code: "validation_error",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const db = getDb();

      // Load existing record
      const { data: existing, error: fetchError } = await db
        .from("lead_outreach")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError || !existing) {
        return reply.status(404).send({ error: "Not found", error_code: "not_found" });
      }

      // CM can only update their own records — 404 to not reveal existence
      if (authUser.role === "cm" && (existing as { user_id: string }).user_id !== authUser.id) {
        return reply.status(404).send({ error: "Not found", error_code: "not_found" });
      }

      const patch = parseResult.data;
      if (patch.campaign_id) {
        const campaignCheck = await loadAuthorizedCampaign(db, patch.campaign_id, authUser);
        if (!campaignCheck.ok) {
          return reply.status(campaignCheck.status).send({
            error: campaignCheck.error,
            error_code: campaignCheck.error_code,
          });
        }
      }
      const mergedStatus = patch.status ?? (existing as { status: string }).status;
      const mergedOutcome =
        "outcome" in patch
          ? (patch.outcome ?? null)
          : (existing as { outcome: string | null }).outcome;
      const mergedLostReason =
        "lost_reason" in patch
          ? (patch.lost_reason ?? null)
          : (existing as { lost_reason: string | null }).lost_reason;

      const statusOutcomeError = validateStatusOutcome(
        mergedStatus,
        mergedOutcome,
        mergedLostReason
      );
      if (statusOutcomeError) {
        return reply.status(400).send({
          error: "Status and outcome are inconsistent",
          error_code: statusOutcomeError,
        });
      }

      // Build update payload (only provided fields)
      const updatePayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) updatePayload[k] = v;
      }

      if (Object.keys(updatePayload).length === 0) {
        return reply.status(400).send({
          error: "No fields to update",
          error_code: "empty_patch",
        });
      }

      const { data: updated, error: updateError } = await db
        .from("lead_outreach")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        request.log.error({ error: updateError }, "outreach patch error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(200).send({ data: updated });
    }
  );

  // POST /api/v1/outreach/generate-offer
  app.post(
    "/outreach/generate-offer",
    { preHandler: requireAuth },
    async (request, reply) => {
      const generateOfferSchema = z.object({
        lead_id: uuidSchema,
        offer_type: z.string().trim().max(80).optional(),
        channel: z.enum(["email", "whatsapp", "linkedin"]).optional(),
      });
      const parsed = generateOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid body",
          error_code: "validation_error",
          issues: parsed.error.flatten(),
        });
      }
      const body = parsed.data;
      const authUser = getAuthUser(request);

      const db = getDb();
      const { data: lead, error: leadErr } = await db
        .from("lead_dashboard")
        .select("id, name, niche, primary_offer, pitch_hook")
        .eq("id", body.lead_id)
        .single();

      if (leadErr || !lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const offerType = body.offer_type ?? (lead as Record<string, string | null>)["primary_offer"] ?? "contacto_directo";
      const channel = body.channel ?? "email";

      if (offerType === "none") {
        return reply.status(400).send({ error: "Lead has no primary offer", error_code: "no_primary_offer" });
      }

      const provider = createLLMProvider();
      const startMs = Date.now();
      let result;
      let usageSuccess = true;
      let usageError: string | null = null;
      const servicePriceUyu = await getAdminServicePrice(db, offerType);

      try {
        result = await provider.generateOffer({
          lead_id: body.lead_id,
          lead_name: (lead as Record<string, string | null>)["name"] ?? "",
          niche: (lead as Record<string, string | null>)["niche"] ?? null,
          primary_offer: (lead as Record<string, string | null>)["primary_offer"] ?? null,
          pitch_hook: (lead as Record<string, string | null>)["pitch_hook"] ?? null,
          offer_type: offerType,
          channel,
          ...(servicePriceUyu != null ? { price_uyu: servicePriceUyu } : {}),
        });
      } catch (err) {
        request.log.error({ err }, "LLM generate-offer error");
        const templateModule = await import("../llm/template.js");
        const templateProvider = new templateModule.TemplateProvider();
        const fallbackReason = err instanceof Error ? err.message : String(err);
        // N80: la llamada al provider FALLÓ — success=false aunque se sirva el template
        // (si no, el monitoreo de failure-rate ve 100% éxito con Gemini caído, y el
        // costo de llamadas fallidas-pero-facturadas desaparece).
        usageSuccess = false;
        usageError = `fallback:${fallbackReason}`;
        result = await templateProvider.generateOffer({
          lead_id: body.lead_id,
          lead_name: (lead as Record<string, string | null>)["name"] ?? "",
          niche: (lead as Record<string, string | null>)["niche"] ?? null,
          primary_offer: (lead as Record<string, string | null>)["primary_offer"] ?? null,
          pitch_hook: (lead as Record<string, string | null>)["pitch_hook"] ?? null,
          offer_type: offerType,
          channel,
          ...(servicePriceUyu != null ? { price_uyu: servicePriceUyu } : {}),
        });
      }

      // Log usage (best-effort — don't fail the request if logging fails)
      const usageRow: LlmUsageLog = {
        provider: result.provider ?? provider.name,
        model: result.model ?? provider.model,
        operation: "generate_offer",
        lead_id: body.lead_id,
        user_id: authUser.id,
        prompt_tokens: result.tokens_in ?? 0,
        completion_tokens: result.tokens_out ?? 0,
        total_tokens: (result.tokens_in ?? 0) + (result.tokens_out ?? 0),
        cost_usd: result.cost_usd_estimated ?? 0,
        duration_ms: Date.now() - startMs,
        success: usageSuccess,
        error: usageError,
      };
      Promise.resolve(db.from("llm_usage_log").insert(usageRow))
        .then(({ error: logErr }) => {
          if (logErr) request.log.warn({ logErr }, "llm_usage_log insert failed");
        })
        .catch((err: unknown) => request.log.warn({ err }, "audit log insert threw"));

      return reply.status(200).send({ data: result });
    }
  );
}
