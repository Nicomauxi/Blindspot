import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, getAuthUser } from "../auth/middleware.js";
import { createLLMProvider } from "../llm/factory.js";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const CONTACT_TIERS = ["A", "B", "C", "D", "X"] as const;
type ContactTier = (typeof CONTACT_TIERS)[number];

const listQuerySchema = z.object({
  contact_tier: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim().toUpperCase())
            .filter((t): t is ContactTier =>
              CONTACT_TIERS.includes(t as ContactTier)
            )
        : (["A", "B", "C", "D"] as ContactTier[])
    ),
  prospect_score_gte: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().min(0).max(100).optional()),
  niche: z.string().optional(),
  source: z.string().optional(),
  primary_offer: z.string().optional(),
  q: z.string().optional(),
  sort_by: z.enum(["created_at", "prospect_score"]).optional().default("created_at"),
  sort_direction: z.enum(["asc", "desc"]).optional().default("desc"),
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

type JsonRecord = Record<string, unknown>;
type CorroboratingSourceRecord = {
  source: string;
  external_id: string;
  confidence: number;
};

type FieldEvidenceRecord = {
  source: string;
  label: string;
  external_id: string | null;
  confidence: number | null;
  role: "primary" | "confirming" | "derived";
  note: string | null;
};

type LeadFieldSourceRecord = {
  label: string;
  value: string | number | boolean | null;
  source: string | null;
  confidence: number | null;
  confirmations: number;
  evidence: FieldEvidenceRecord[];
};

type CommercialEvidenceNode = {
  id: string;
  title: string;
  summary: string;
  strength: "high" | "medium" | "low";
  source: string | null;
  confirmations: number;
  evidence: string[];
  children?: CommercialEvidenceNode[];
};

type LeadSortBy = "created_at" | "prospect_score";
type LeadSortDirection = "asc" | "desc";
type LeadCursorPayload = {
  sort_by: LeadSortBy;
  sort_direction: LeadSortDirection;
  id: string;
  created_at: string;
  prospect_score: number | null;
};

function encodeLeadCursor(payload: LeadCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeLeadCursor(value: string): LeadCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    const id = asNullableString(parsed["id"]);
    const createdAt = asNullableString(parsed["created_at"]);
    const sortBy = parsed["sort_by"];
    const sortDirection = parsed["sort_direction"];
    if (!id || !createdAt) return null;
    if (sortBy !== "created_at" && sortBy !== "prospect_score") return null;
    if (sortDirection !== "asc" && sortDirection !== "desc") return null;
    return {
      sort_by: sortBy,
      sort_direction: sortDirection,
      id,
      created_at: createdAt,
      prospect_score: asNullableNumber(parsed["prospect_score"]),
    };
  } catch {
    return null;
  }
}

async function resolveLeadCursor(
  db: ReturnType<typeof getDb>,
  rawCursor: string,
  sortBy: LeadSortBy,
  sortDirection: LeadSortDirection
): Promise<LeadCursorPayload | null> {
  const decoded = decodeLeadCursor(rawCursor);
  if (decoded) return decoded;
  if (!permissiveUuid.safeParse(rawCursor).success) return null;

  const { data } = await db
    .from("lead_dashboard")
    .select("id, created_at, prospect_score")
    .eq("id", rawCursor)
    .maybeSingle();

  if (!data || typeof data !== "object") return null;
  return {
    sort_by: sortBy,
    sort_direction: sortDirection,
    id: asNullableString(data["id"]) ?? rawCursor,
    created_at: asNullableString(data["created_at"]) ?? new Date(0).toISOString(),
    prospect_score: asNullableNumber(data["prospect_score"]),
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function titleCase(value: string): string {
  return value
    .split(/[\_\-\s]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function humanizeSource(source: string | null): string {
  if (!source) return "Fuente no identificada";
  switch (source) {
    case "google_places":
      return "Google Places";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "website":
      return "Website";
    case "manual":
      return "Carga manual";
    case "scoring_engine":
      return "Motor de scoring";
    case "inference_engine":
      return "Motor de inferencia";
    default:
      return titleCase(source);
  }
}

function canonicalFieldRecord(
  canonicalFields: JsonRecord | null,
  field: "email" | "phone" | "website"
): JsonRecord | null {
  if (!canonicalFields) return null;
  const raw = canonicalFields[field];
  return isRecord(raw) ? raw : null;
}

function canonicalFieldValue(
  canonicalFields: JsonRecord | null,
  field: "email" | "phone" | "website"
): string | null {
  if (!canonicalFields) return null;
  const raw = canonicalFields[field];
  if (typeof raw === "string") return asNullableString(raw);
  if (isRecord(raw)) return asNullableString(raw["value"]);
  return null;
}

function scoreBreakdownValue(row: JsonRecord, key: string): string | null {
  const direct = asNullableString(row[key]);
  if (direct) return direct;
  const breakdown = isRecord(row["score_breakdown"]) ? row["score_breakdown"] : null;
  return breakdown ? asNullableString(breakdown[key]) : null;
}

function asCorroboratingSources(value: unknown): CorroboratingSourceRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      source: asNullableString(item["source"]) ?? "unknown",
      external_id: asNullableString(item["external_id"]) ?? "",
      confidence: asNullableNumber(item["confidence"]) ?? 0,
    }));
}

function normalizeScalarValue(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return asNullableString(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function dedupeEvidence(items: FieldEvidenceRecord[]): FieldEvidenceRecord[] {
  const seen = new Set<string>();
  const result: FieldEvidenceRecord[] = [];
  for (const item of items) {
    const key = [item.source, item.external_id ?? "", item.role, item.note ?? ""].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function corroboratingEvidence(sources: CorroboratingSourceRecord[]): FieldEvidenceRecord[] {
  return sources.map((entry) => ({
    source: entry.source,
    label: humanizeSource(entry.source),
    external_id: entry.external_id || null,
    confidence: entry.confidence,
    role: "confirming",
    note: null,
  }));
}

function evidenceFromCanonicalField(value: unknown): FieldEvidenceRecord[] {
  if (!isRecord(value)) return [];
  const primarySource =
    asNullableString(value["source"]) ??
    asNullableString(value["origin"]) ??
    asNullableString(value["provider"]);
  const primary = primarySource
    ? [{
        source: primarySource,
        label: humanizeSource(primarySource),
        external_id:
          asNullableString(value["external_id"]) ??
          asNullableString(value["externalId"]),
        confidence: asNullableNumber(value["confidence"]),
        role: "primary" as const,
        note: null,
      }]
    : [];

  const nested = ["confirmed_by", "confirmations", "sources", "evidence"]
    .flatMap((key) => {
      const raw = value[key];
      return Array.isArray(raw) ? raw : [];
    })
    .filter(isRecord)
    .map((item) => {
      const source =
        asNullableString(item["source"]) ??
        asNullableString(item["origin"]) ??
        asNullableString(item["provider"]) ??
        "unknown";
      return {
        source,
        label: humanizeSource(source),
        external_id:
          asNullableString(item["external_id"]) ??
          asNullableString(item["externalId"]),
        confidence: asNullableNumber(item["confidence"]),
        role: "confirming" as const,
        note: asNullableString(item["note"]),
      };
    });

  return dedupeEvidence([...primary, ...nested]);
}

function buildFieldSource(args: {
  label: string;
  value: unknown;
  canonicalField?: JsonRecord | null;
  primarySource?: string | null;
  fallbackConfidence?: number | null;
  corroboratingSources?: CorroboratingSourceRecord[];
  derivedNote?: string | null;
}): LeadFieldSourceRecord {
  const normalizedValue = normalizeScalarValue(args.value);
  const evidence: FieldEvidenceRecord[] = [];

  if (args.canonicalField) {
    evidence.push(...evidenceFromCanonicalField(args.canonicalField));
  }

  if (args.primarySource && evidence.length === 0 && normalizedValue !== null) {
    evidence.push({
      source: args.primarySource,
      label: humanizeSource(args.primarySource),
      external_id: null,
      confidence: args.fallbackConfidence ?? null,
      role: args.derivedNote ? "derived" : "primary",
      note: args.derivedNote ?? null,
    });
  }

  if (args.derivedNote && evidence.length > 0) {
    const firstEvidence = evidence[0];
    if (firstEvidence) {
      evidence[0] = {
        ...firstEvidence,
        role: firstEvidence.role === "confirming" ? "derived" : firstEvidence.role,
        note: firstEvidence.note ?? args.derivedNote,
      };
    }
  }

  evidence.push(...corroboratingEvidence(args.corroboratingSources ?? []));

  const deduped = dedupeEvidence(evidence);
  const primary = deduped.find((item) => item.role !== "confirming") ?? deduped[0] ?? null;

  return {
    label: args.label,
    value: normalizedValue,
    source: primary?.source ?? null,
    confidence: primary?.confidence ?? args.fallbackConfidence ?? null,
    confirmations: deduped.filter((item) => item.role === "confirming").length,
    evidence: deduped,
  };
}

function inferenceSignals(inferredState: JsonRecord | null): string[] {
  if (!inferredState) return [];
  return Object.entries(inferredState)
    .flatMap(([key, value]) => {
      if (!isRecord(value) || value["value"] !== true) return [];
      const confidence = asNullableNumber(value["confidence"]);
      return [`${titleCase(key)}${confidence != null ? ` (${Math.round(confidence * 100)}%)` : ""}`];
    })
    .slice(0, 4);
}

function digitalSignals(digitalFootprint: JsonRecord | null): string[] {
  if (!digitalFootprint) return [];
  const signals: string[] = [];
  const emailQuality = Array.isArray(digitalFootprint["email_quality"])
    ? (digitalFootprint["email_quality"] as unknown[])
        .filter(isRecord)
        .map((entry) => asNullableString(entry["quality"]))
        .filter((entry): entry is string => Boolean(entry) && entry !== "unknown")
    : [];
  if (emailQuality.length > 0) {
    signals.push(`Calidad de email: ${emailQuality[0]}`);
  }
  const phoneTypes = Array.isArray(digitalFootprint["phone_classification"])
    ? (digitalFootprint["phone_classification"] as unknown[])
        .filter(isRecord)
        .map((entry) => asNullableString(entry["type"]))
        .filter((entry): entry is string => Boolean(entry) && entry !== "unknown")
    : [];
  if (phoneTypes.length > 0) {
    signals.push(`Tipo de teléfono: ${phoneTypes[0]}`);
  }
  const lastChange = isRecord(digitalFootprint["last_change_diff"])
    ? Object.keys(digitalFootprint["last_change_diff"] as Record<string, unknown>).slice(0, 3)
    : [];
  if (lastChange.length > 0) {
    signals.push(`Cambios recientes detectados: ${lastChange.join(", ")}`);
  }
  const level = asNullableString(digitalFootprint["digitalization_level"]);
  if (level) {
    signals.push(`Nivel digital: ${level}`);
  }
  return signals;
}

function evidenceStrength(score: number | null, ready: boolean | null): "high" | "medium" | "low" {
  if ((score ?? 0) >= 75 || ready === true) return "high";
  if ((score ?? 0) >= 50) return "medium";
  return "low";
}

function buildCommercialEvidenceTree(
  normalizedLead: JsonRecord,
  fieldSources: Record<string, LeadFieldSourceRecord>
): CommercialEvidenceNode[] {
  const companyData = isRecord(normalizedLead["lead_company_data"]) ? normalizedLead["lead_company_data"] : null;
  const digitalFootprint = isRecord(normalizedLead["digital_footprint"]) ? normalizedLead["digital_footprint"] : null;
  const inferredState = isRecord(normalizedLead["inferred_state"]) ? normalizedLead["inferred_state"] : null;
  const score = asNullableNumber(normalizedLead["prospect_score"]);
  const contactReady = asBooleanOrNull(normalizedLead["contact_ready"]);
  const offerTrace = fieldSources["primary_offer"];
  const urgencyTrace = fieldSources["urgency_signal"];
  const contactTrace = fieldSources["contact_ready"];
  const detectedSubNiche = companyData ? asNullableString(companyData["detected_sub_niche"]) : null;
  const digitalizationLevel = companyData ? asNullableString(companyData["digitalization_level"]) : null;

  return [
    {
      id: "offer",
      title: "Oferta y ángulo de entrada",
      summary: typeof offerTrace?.value === "string" ? offerTrace.value : "Sin oferta sugerida",
      strength: evidenceStrength(score, contactReady),
      source: offerTrace?.source ?? null,
      confirmations: offerTrace?.confirmations ?? 0,
      evidence: [
        typeof normalizedLead["pitch_hook"] === "string" ? `Pitch hook: ${normalizedLead["pitch_hook"]}` : null,
        typeof normalizedLead["top_buyer_type"] === "string" ? `Buyer probable: ${normalizedLead["top_buyer_type"]}` : null,
        detectedSubNiche ? `Subnicho detectado: ${detectedSubNiche}` : null,
        typeof normalizedLead["niche"] === "string" ? `Rubro: ${normalizedLead["niche"]}` : null,
      ].filter((item): item is string => Boolean(item)),
    },
    {
      id: "contact",
      title: "Readiness de contacto",
      summary:
        contactReady === true
          ? "El lead parece listo para primer contacto"
          : contactReady === false
            ? "Conviene validar contacto antes de salir a vender"
            : "No hay certeza sobre la calidad del contacto",
      strength: evidenceStrength(score, contactReady),
      source: contactTrace?.source ?? null,
      confirmations: contactTrace?.confirmations ?? 0,
      evidence: [
        typeof normalizedLead["contact_tier"] === "string" ? `Tier: ${normalizedLead["contact_tier"]}` : null,
        normalizedLead["phone"] ? "Tiene teléfono" : null,
        normalizedLead["whatsapp"] ? "Tiene WhatsApp" : null,
        normalizedLead["email"] ? "Tiene email" : null,
        normalizedLead["website"] ? "Tiene website" : null,
        asNullableNumber(normalizedLead["contact_reliability_score"])
          ? `Confiabilidad contacto: ${Math.round(((normalizedLead["contact_reliability_score"] as number) ?? 0) * 100)}%`
          : null,
        ...digitalSignals(digitalFootprint),
      ].filter((item): item is string => Boolean(item)),
    },
    {
      id: "urgency",
      title: "Señales de timing",
      summary: typeof urgencyTrace?.value === "string" ? urgencyTrace.value : "Sin urgencia explícita detectada",
      strength: urgencyTrace?.value ? "medium" : "low",
      source: urgencyTrace?.source ?? null,
      confirmations: urgencyTrace?.confirmations ?? 0,
      evidence: [
        typeof normalizedLead["business_status"] === "string" ? `Estado comercial: ${normalizedLead["business_status"]}` : null,
        digitalizationLevel ? `Nivel digital: ${digitalizationLevel}` : null,
        ...inferenceSignals(inferredState),
      ].filter((item): item is string => Boolean(item)),
    },
  ];
}

function buildFieldSources(
  normalizedLead: JsonRecord,
  canonicalFields: JsonRecord | null,
  corroboratingSources: CorroboratingSourceRecord[]
): Record<string, LeadFieldSourceRecord> {
  const canonicalSource = asNullableString(normalizedLead["canonical_source"]);
  const source = asNullableString(normalizedLead["source"]);
  const baseSource = canonicalSource ?? source ?? "unknown";
  const sourceConfidence = asNullableNumber(normalizedLead["source_confidence"]);
  const dataConfidence = asNullableNumber(normalizedLead["data_confidence_score"]);
  const contactReliability = asNullableNumber(normalizedLead["contact_reliability_score"]);

  return {
    name: buildFieldSource({ label: "Nombre comercial", value: normalizedLead["name"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    niche: buildFieldSource({ label: "Rubro", value: normalizedLead["niche"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    address: buildFieldSource({ label: "Dirección", value: normalizedLead["address"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    phone: buildFieldSource({ label: "Teléfono", value: normalizedLead["phone"], canonicalField: canonicalFieldRecord(canonicalFields, "phone"), primarySource: baseSource, fallbackConfidence: contactReliability, corroboratingSources }),
    whatsapp: buildFieldSource({ label: "WhatsApp", value: normalizedLead["whatsapp"], primarySource: baseSource, fallbackConfidence: contactReliability, corroboratingSources }),
    email: buildFieldSource({ label: "Email", value: normalizedLead["email"], canonicalField: canonicalFieldRecord(canonicalFields, "email"), primarySource: baseSource, fallbackConfidence: contactReliability, corroboratingSources }),
    website: buildFieldSource({ label: "Website", value: normalizedLead["website"], canonicalField: canonicalFieldRecord(canonicalFields, "website"), primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    rating: buildFieldSource({ label: "Rating público", value: normalizedLead["rating"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    review_count: buildFieldSource({ label: "Cantidad de reseñas", value: normalizedLead["review_count"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
    primary_offer: buildFieldSource({ label: "Oferta sugerida", value: normalizedLead["primary_offer"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Derivada desde score_breakdown y señales comerciales." }),
    pitch_hook: buildFieldSource({ label: "Pitch hook", value: normalizedLead["pitch_hook"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Ángulo comercial sugerido a partir de señales del lead." }),
    urgency_signal: buildFieldSource({ label: "Urgencia", value: normalizedLead["urgency_signal"], primarySource: "inference_engine", fallbackConfidence: dataConfidence, derivedNote: "Inferida desde estado del negocio y huella digital." }),
    contact_ready: buildFieldSource({ label: "Contacto listo", value: normalizedLead["contact_ready"], primarySource: "scoring_engine", fallbackConfidence: contactReliability, derivedNote: "Evaluación compuesta de calidad de contacto y señales de negocio." }),
    contact_tier: buildFieldSource({ label: "Tier de contacto", value: normalizedLead["contact_tier"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Clasificación comercial operativa." }),
    top_buyer_type: buildFieldSource({ label: "Buyer probable", value: normalizedLead["top_buyer_type"], primarySource: "scoring_engine", fallbackConfidence: dataConfidence, derivedNote: "Inferido para orientar la conversación comercial." }),
    business_status: buildFieldSource({ label: "Estado comercial", value: normalizedLead["business_status"], primarySource: baseSource, fallbackConfidence: sourceConfidence, corroboratingSources }),
  };
}

function normalizeLeadRow(row: JsonRecord): JsonRecord {
  const canonicalFields = isRecord(row["canonical_fields"]) ? row["canonical_fields"] : null;
  const corroboratingSources = asCorroboratingSources(row["corroborating_sources"]);

  const normalized: JsonRecord = {
    id: asNullableString(row["id"]) ?? "",
    name: asNullableString(row["name"]) ?? "",
    niche: asNullableString(row["niche"]),
    source: asNullableString(row["source"]) ?? "unknown",
    canonical_source: asNullableString(row["canonical_source"]),
    address: asNullableString(row["address"]),
    phone:
      asNullableString(row["phone"]) ??
      asNullableString(row["contact_phone"]) ??
      canonicalFieldValue(canonicalFields, "phone"),
    whatsapp: asNullableString(row["whatsapp"]) ?? asNullableString(row["contact_whatsapp"]),
    email: asNullableString(row["email"]) ?? canonicalFieldValue(canonicalFields, "email"),
    website:
      asNullableString(row["website"]) ??
      canonicalFieldValue(canonicalFields, "website"),
    rating: asNullableNumber(row["rating"]),
    review_count: asNullableNumber(row["review_count"]),
    tags: asStringArray(row["tags"]),
    state: asNullableString(row["state"]) ?? "discovered",
    business_status: asNullableString(row["business_status"]),
    source_confidence: asNullableNumber(row["source_confidence"]),
    data_confidence_score: asNullableNumber(row["data_confidence_score"]),
    contact_reliability_score: asNullableNumber(row["contact_reliability_score"]),
    contact_ready: asBooleanOrNull(row["contact_ready"]),
    prospect_score: asNullableNumber(row["prospect_score"]),
    contact_tier: scoreBreakdownValue(row, "contact_tier"),
    primary_offer: scoreBreakdownValue(row, "primary_offer"),
    pitch_hook: scoreBreakdownValue(row, "pitch_hook"),
    urgency_signal: scoreBreakdownValue(row, "urgency_signal"),
    contacted_at: asNullableString(row["contacted_at"]),
    contacted_by: asNullableString(row["contacted_by"]),
    created_at: asNullableString(row["created_at"]) ?? "",
    corroborating_sources: corroboratingSources,
    top_buyer_type: asNullableString(row["top_buyer_type"]),
    top_buyer_score: asNullableNumber(row["top_buyer_score"]),
    owner_group_id: asNullableString(row["owner_group_id"]),
    notes: asNullableString(row["notes"]),
    digital_footprint: isRecord(row["digital_footprint"]) ? row["digital_footprint"] : null,
    inferred_state: isRecord(row["inferred_state"]) ? row["inferred_state"] : null,
    score_breakdown: isRecord(row["score_breakdown"]) ? row["score_breakdown"] : null,
    lead_company_data: isRecord(row["lead_company_data"]) ? row["lead_company_data"] : null,
    canonical_fields: canonicalFields,
    search_vector: row["search_vector"] ?? null,
    sources_count: asNullableNumber(row["sources_count"]) ?? corroboratingSources.length,
  };

  const fieldSources = buildFieldSources(normalized, canonicalFields, corroboratingSources);
  return {
    ...normalized,
    field_sources: fieldSources,
    commercial_evidence_tree: buildCommercialEvidenceTree(normalized, fieldSources),
  };
}

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/leads",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const parseResult = listQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Invalid query parameters",
          error_code: "invalid_query",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const {
        contact_tier,
        prospect_score_gte,
        niche,
        source,
        primary_offer,
        q,
        sort_by,
        sort_direction,
        cursor,
        limit,
      } = parseResult.data;

      const db = getDb();

      // Build Supabase query from lead_dashboard VIEW
      let query = db.from("lead_dashboard").select("*", { count: "exact" });

      // Apply CM lead_filter (must be applied before request filters — intersection)
      if (authUser.role === "cm") {
        if (!authUser.lead_filter) {
          // CM with null lead_filter sees nothing (fail closed)
          return reply.status(200).send({ data: [], next_cursor: null, total: 0 });
        }
        // Apply contact_tier from lead_filter as intersection
        const filterTiers = authUser.lead_filter["contact_tier"];
        if (Array.isArray(filterTiers) && filterTiers.length > 0) {
          const effectiveTiers = contact_tier.filter((t) =>
            filterTiers.includes(t)
          );
          if (effectiveTiers.length === 0) {
            return reply.status(200).send({ data: [], next_cursor: null, total: 0 });
          }
          query = query.in("contact_tier", effectiveTiers);
        } else {
          query = query.in("contact_tier", contact_tier);
        }
      } else {
        query = query.in("contact_tier", contact_tier);
      }

      if (prospect_score_gte !== undefined) {
        query = query.gte("prospect_score", prospect_score_gte);
      }
      if (niche) {
        query = query.eq("niche", niche);
      }
      if (source) {
        query = query.eq("source", source);
      }
      if (primary_offer) {
        query = query.eq("primary_offer", primary_offer);
      }
      if (q) {
        query = query.textSearch("search_vector", q, { type: "plain", config: "spanish" });
      }

      const resolvedCursor = cursor
        ? await resolveLeadCursor(db, cursor, sort_by, sort_direction)
        : null;

      if (resolvedCursor) {
        if (sort_by === "prospect_score") {
          const score = resolvedCursor.prospect_score ?? -1;
          const comparator = sort_direction === "asc" ? "gt" : "lt";
          query = query.or(
            [
              `prospect_score.${comparator}.${score}`,
              `and(prospect_score.eq.${score},created_at.lt.${resolvedCursor.created_at})`,
              `and(prospect_score.eq.${score},created_at.eq.${resolvedCursor.created_at},id.lt.${resolvedCursor.id})`,
            ].join(",")
          );
        } else {
          query = query.or(
            [
              `created_at.${sort_direction === "asc" ? "gt" : "lt"}.${resolvedCursor.created_at}`,
              `and(created_at.eq.${resolvedCursor.created_at},id.${sort_direction === "asc" ? "gt" : "lt"}.${resolvedCursor.id})`,
            ].join(",")
          );
        }
      }

      if (sort_by === "prospect_score") {
        query = query
          .order("prospect_score", { ascending: sort_direction === "asc", nullsFirst: false })
          .order("created_at", { ascending: sort_direction === "asc" })
          .order("id", { ascending: sort_direction === "asc" });
      } else {
        query = query
          .order("created_at", { ascending: sort_direction === "asc" })
          .order("id", { ascending: sort_direction === "asc" });
      }

      query = query.limit(limit + 1);

      const { data, error, count } = await query;

      if (error) {
        request.log.error({ error }, "leads query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      const rows = (data ?? []).map((row) => normalizeLeadRow(row as JsonRecord));
      const cmLeadFilter = authUser.role === "cm" ? authUser.lead_filter : null;
      const filteredRows = cmLeadFilter
        ? rows.filter((row) => passesLeadFilter(row, cmLeadFilter))
        : rows;
      const maxVisible =
        authUser.role === "cm" &&
        typeof authUser.lead_filter?.["max_leads_visible"] === "number" &&
        Number.isFinite(authUser.lead_filter["max_leads_visible"])
          ? Math.max(0, authUser.lead_filter["max_leads_visible"] as number)
          : null;
      const cappedRows = maxVisible === null ? filteredRows : filteredRows.slice(0, maxVisible);
      const hasMore = cappedRows.length > limit;
      const page = hasMore ? cappedRows.slice(0, limit) : cappedRows;
      const lastRow = page[page.length - 1] as JsonRecord | undefined;
      const nextCursor =
        hasMore && lastRow
          ? encodeLeadCursor({
              sort_by,
              sort_direction,
              id: asNullableString(lastRow["id"]) ?? "",
              created_at: asNullableString(lastRow["created_at"]) ?? new Date(0).toISOString(),
              prospect_score: asNullableNumber(lastRow["prospect_score"]),
            })
          : null;

      return reply.status(200).send({
        data: page,
        next_cursor: nextCursor,
        total: maxVisible === null ? count ?? page.length : Math.min(count ?? page.length, maxVisible),
      });
    }
  );

  app.get(
    "/leads/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id
        )
      ) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const db = getDb();

      // Admin: can access rejected leads with ?include_rejected=true
      const { include_rejected } = request.query as { include_rejected?: string };
      const adminIncludeRejected =
        authUser.role === "admin" && include_rejected === "true";

      let lead: Record<string, unknown> | null = null;

      if (adminIncludeRejected) {
        // Query directly from leads table (bypasses VIEW's passed_filter=true)
        const { data, error } = await db
          .from("leads")
          .select("*")
          .eq("id", id)
          .single();
        if (!error && data) lead = data as Record<string, unknown>;
      } else {
        const { data, error } = await db
          .from("lead_dashboard")
          .select("*")
          .eq("id", id)
          .single();
        if (!error && data) lead = data as Record<string, unknown>;
      }

      if (!lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const normalizedLead = normalizeLeadRow(lead as JsonRecord);

      // CM filter check — 404 (not 403) to not reveal existence
      if (authUser.role === "cm") {
        if (!authUser.lead_filter) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
        if (!passesLeadFilter(normalizedLead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
      }

      return reply.status(200).send({ data: normalizedLead });
    }
  );

  // GET /api/v1/leads/:id/owner-group — list sibling leads sharing the same owner
  app.get(
    "/leads/:id/owner-group",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authUser = getAuthUser(request);
      const { id } = request.params as { id: string };

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const db = getDb();

      const { data: lead, error: leadErr } = await db
        .from("lead_dashboard")
        .select("*")
        .eq("id", id)
        .single();

      if (leadErr || !lead) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const normalizedLead = normalizeLeadRow(lead as JsonRecord);

      if (authUser.role === "cm") {
        if (!authUser.lead_filter || !passesLeadFilter(normalizedLead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
      }

      const groupId = normalizedLead["owner_group_id"];
      if (!groupId) {
        return reply.status(200).send({ data: [] });
      }

      const { data: siblings, error: siblingsErr } = await db
        .from("lead_dashboard")
        .select("*")
        .eq("owner_group_id", groupId)
        .neq("id", id);

      if (siblingsErr) {
        request.log.error({ error: siblingsErr }, "owner-group query error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      let results = siblings ?? [];

      if (authUser.role === "cm" && authUser.lead_filter) {
        results = results.filter((s) =>
          passesLeadFilter(
            normalizeLeadRow(s as JsonRecord),
            authUser.lead_filter as Record<string, unknown>
          )
        );
      }

      return reply.status(200).send({
        data: results.map((row) => normalizeLeadRow(row as JsonRecord)),
      });
    }
  );

  app.post(
    "/leads/:id/assistant-brief",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const authUser = getAuthUser(request);
      const db = getDb();
      const { data, error } = await db.from("lead_dashboard").select("*").eq("id", id).single();

      if (error || !data) {
        return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
      }

      const normalizedLead = normalizeLeadRow(data as JsonRecord);

      if (authUser.role === "cm") {
        if (!authUser.lead_filter || !passesLeadFilter(normalizedLead, authUser.lead_filter)) {
          return reply.status(404).send({ error: "Lead not found", error_code: "not_found" });
        }
      }

      const provider = createLLMProvider();
      const startedAt = Date.now();
      let result;
      let success = true;
      let errorMessage: string | null = null;

      try {
        result = await provider.generateLeadBrief({
          lead_id: id,
          lead_name: (normalizedLead["name"] as string) ?? "",
          niche: (normalizedLead["niche"] as string | null) ?? null,
          contact_tier: (normalizedLead["contact_tier"] as string | null) ?? null,
          prospect_score: (normalizedLead["prospect_score"] as number | null) ?? null,
          urgency_signal: (normalizedLead["urgency_signal"] as string | null) ?? null,
          primary_offer: (normalizedLead["primary_offer"] as string | null) ?? null,
          pitch_hook: (normalizedLead["pitch_hook"] as string | null) ?? null,
          state: (normalizedLead["state"] as string | null) ?? null,
          contact_ready: (normalizedLead["contact_ready"] as boolean | null) ?? null,
          top_buyer_type: (normalizedLead["top_buyer_type"] as string | null) ?? null,
          business_status: (normalizedLead["business_status"] as string | null) ?? null,
          phone: (normalizedLead["phone"] as string | null) ?? null,
          whatsapp: (normalizedLead["whatsapp"] as string | null) ?? null,
          email: (normalizedLead["email"] as string | null) ?? null,
          website: (normalizedLead["website"] as string | null) ?? null,
          contact_reliability_score: (normalizedLead["contact_reliability_score"] as number | null) ?? null,
          source_confidence: (normalizedLead["source_confidence"] as number | null) ?? null,
        });
      } catch (err) {
        const primaryError = err instanceof Error ? err.message : String(err);
        errorMessage = primaryError;
        request.log.error({ err }, "LLM lead brief error");
        try {
          const templateModule = await import("../llm/template.js");
          const templateProvider = new templateModule.TemplateProvider();
          result = await templateProvider.generateLeadBrief({
            lead_id: id,
            lead_name: (normalizedLead["name"] as string) ?? "",
            niche: (normalizedLead["niche"] as string | null) ?? null,
            contact_tier: (normalizedLead["contact_tier"] as string | null) ?? null,
            prospect_score: (normalizedLead["prospect_score"] as number | null) ?? null,
            urgency_signal: (normalizedLead["urgency_signal"] as string | null) ?? null,
            primary_offer: (normalizedLead["primary_offer"] as string | null) ?? null,
            pitch_hook: (normalizedLead["pitch_hook"] as string | null) ?? null,
            state: (normalizedLead["state"] as string | null) ?? null,
            contact_ready: (normalizedLead["contact_ready"] as boolean | null) ?? null,
            top_buyer_type: (normalizedLead["top_buyer_type"] as string | null) ?? null,
            business_status: (normalizedLead["business_status"] as string | null) ?? null,
            phone: (normalizedLead["phone"] as string | null) ?? null,
            whatsapp: (normalizedLead["whatsapp"] as string | null) ?? null,
            email: (normalizedLead["email"] as string | null) ?? null,
            website: (normalizedLead["website"] as string | null) ?? null,
            contact_reliability_score: (normalizedLead["contact_reliability_score"] as number | null) ?? null,
            source_confidence: (normalizedLead["source_confidence"] as number | null) ?? null,
          });
          errorMessage = `fallback:${primaryError}`;
        } catch (fallbackErr) {
          success = false;
          const fallbackMessage =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          errorMessage = `primary:${primaryError}; fallback:${fallbackMessage}`;
          request.log.error({ fallbackErr }, "Template lead brief fallback error");
          db.from("llm_usage_log").insert({
            provider: provider.name,
            model: provider.model,
            operation: "lead_brief",
            lead_id: id,
            user_id: authUser.id,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cost_usd: 0,
            duration_ms: Date.now() - startedAt,
            success,
            error: errorMessage,
          }).then(({ error: logErr }) => {
            if (logErr) request.log.warn({ logErr }, "llm_usage_log insert failed");
          });
          return reply.status(502).send({
            error: "Assistant brief unavailable",
            error_code: "assistant_unavailable",
          });
        }
      }

      db.from("llm_usage_log").insert({
        provider: result.provider ?? provider.name,
        model: result.model ?? provider.model,
        operation: "lead_brief",
        lead_id: id,
        user_id: authUser.id,
        prompt_tokens: result.tokens_in ?? 0,
        completion_tokens: result.tokens_out ?? 0,
        total_tokens: (result.tokens_in ?? 0) + (result.tokens_out ?? 0),
        cost_usd: result.cost_usd_estimated ?? 0,
        duration_ms: Date.now() - startedAt,
        success,
        error: errorMessage,
      }).then(({ error: logErr }) => {
        if (logErr) request.log.warn({ logErr }, "llm_usage_log insert failed");
      });

      return reply.status(200).send({ data: result });
    }
  );
}

function passesLeadFilter(
  lead: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  const tierFilter = filter["contact_tier"];
  if (Array.isArray(tierFilter) && tierFilter.length > 0) {
    const leadTier = lead["contact_tier"] as string | undefined;
    if (!leadTier || !tierFilter.includes(leadTier)) return false;
  }

  const primaryOffer = filter["primary_offer"];
  if (typeof primaryOffer === "string" && primaryOffer) {
    if (lead["primary_offer"] !== primaryOffer) return false;
  } else if (Array.isArray(primaryOffer) && primaryOffer.length > 0) {
    const leadOffer = lead["primary_offer"] as string | undefined;
    if (!leadOffer || !primaryOffer.includes(leadOffer)) return false;
  }

  const nicheFilter = filter["niche"];
  if (Array.isArray(nicheFilter) && nicheFilter.length > 0) {
    const leadNiche = lead["niche"] as string | undefined;
    if (!leadNiche || !nicheFilter.includes(leadNiche)) return false;
  }

  const sourceFilter = filter["source"];
  if (Array.isArray(sourceFilter) && sourceFilter.length > 0) {
    const leadSource = lead["source"] as string | undefined;
    if (!leadSource || !sourceFilter.includes(leadSource)) return false;
  }

  if (filter["exclude_contacted"] === true && lead["contacted_at"] != null) {
    return false;
  }

  if (
    filter["exclude_franchises"] === true &&
    Array.isArray(lead["tags"]) &&
    (lead["tags"] as unknown[]).includes("franchise-detected")
  ) {
    return false;
  }

  const requireState = filter["require_inferred_state"];
  if (isRecord(requireState)) {
    const inferredState = isRecord(lead["inferred_state"]) ? lead["inferred_state"] : null;
    const boolChecks = [
      "has_delivery",
      "has_pos",
      "has_reservations",
    ] as const;
    for (const key of boolChecks) {
      if (requireState[key] === true) {
        const fieldValue = inferredState && isRecord(inferredState[key])
          ? inferredState[key]["value"]
          : null;
        if (fieldValue !== true) return false;
      }
    }
  }

  const detectedSubNiche = filter["detected_sub_niche"];
  if (Array.isArray(detectedSubNiche) && detectedSubNiche.length > 0) {
    const companyData = isRecord(lead["lead_company_data"]) ? lead["lead_company_data"] : null;
    const leadSubNiche = companyData ? asNullableString(companyData["detected_sub_niche"]) : null;
    if (!leadSubNiche || !detectedSubNiche.includes(leadSubNiche)) return false;
  }

  return true;
}
