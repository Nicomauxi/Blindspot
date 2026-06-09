import pLimit from "p-limit";
import { getConfig } from "../../shared/config.js";
import { getLogger } from "../../shared/logger.js";
import type {
  HeuristicCandidate,
  Lead,
  PlaywrightSocialSearch,
  PlaywrightFacebookSearchResult,
  PlaywrightInstagramSearchResult,
} from "../../shared/types.js";
import {
  loadAllLeads,
  loadLeadsByRunId,
  updateLeadSocialSearch,
  updateLeadSocialEnrichStatus,
} from "../../storage/leads.js";
import { getSocialSearchRefreshDays, isUruguayMobilePhone } from "../enrichment/social-search.js";
import { getScrapingConfig } from "../discovery/config.js";
import { randomBetween } from "../../shared/scraping.js";
import { openSocialEnrichBrowser } from "./browser.js";
import { extractFacebookProfile } from "./facebook.js";
import { extractInstagramProfile } from "./instagram.js";
import {
  buildSocialActivitySnapshot,
  facebookProfile,
  instagramProfile,
  type SocialActivityProfile,
} from "./social-activity.js";
import { parseSocialDescription } from "./description-parse.js";
import { mergeSocialIntoCanonical, type SocialCanonicalInput } from "./social-canonical.js";
import { recordSocialSnapshots } from "../../storage/social-snapshots.js";

export interface SocialEnrichOptions {
  run?: string;
  all?: boolean;
  limit?: number;
  force: boolean;
}

export interface SocialEnrichStats {
  loaded: number;
  selected: number;
  processed: number;
  skippedFresh: number;
  errors: number;
  blocked: number;
}

const DEFAULT_LIMIT = 10;
const CONFIRMATION_THRESHOLD = 0.7;

function getConcurrency(): number {
  return getConfig().SOCIAL_ENRICH_CONCURRENCY;
}

function isFreshPlaywrightSearch(lead: Lead): boolean {
  const social = lead.digital_footprint?.social_search;
  if (!social || social.source !== "playwright") return false;
  const t = Date.parse(social.ran_at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < getSocialSearchRefreshDays() * 24 * 60 * 60 * 1_000;
}

function selectedHeuristicUrl(lead: Lead, platform: "facebook" | "instagram"): string | null {
  const candidate = lead.digital_footprint?.heuristic_discovery?.selected[platform] as
    | HeuristicCandidate
    | null
    | undefined;
  return candidate?.url ?? null;
}

// Un lead es candidato a social-enrich si pasó el filtro y tiene una red para medir:
// sea por tag heurístico, o porque ya hay una URL FB/IG seleccionada (cubre los leads que
// tienen candidata pero nunca fueron medidos — antes quedaban fuera por gating de tag).
function hasSocialCandidate(lead: Lead): boolean {
  if (!lead.passed_filter) return false;
  const tags = new Set(lead.tags);
  if (tags.has("fb-heuristic") || tags.has("ig-heuristic")) return true;
  return selectedHeuristicUrl(lead, "facebook") !== null || selectedHeuristicUrl(lead, "instagram") !== null;
}

function tagsForResult(
  facebook: PlaywrightFacebookSearchResult | null,
  instagram: PlaywrightInstagramSearchResult | null
): { tags: string[]; whatsapp: string | null } {
  const tags: string[] = [];
  let whatsapp: string | null = null;

  if (facebook && facebook.confidence >= CONFIRMATION_THRESHOLD) {
    tags.push("fb-confirmed");
    if (facebook.whatsapp_button) tags.push("whatsapp-confirmed");
    if (facebook.phone && isUruguayMobilePhone(facebook.phone)) {
      tags.push("whatsapp-derived");
      whatsapp = facebook.phone;
    }
  }
  if (instagram && instagram.confidence >= CONFIRMATION_THRESHOLD) {
    tags.push("ig-confirmed");
  }

  return { tags, whatsapp };
}

const BLOCKED_SIGNALS = ["blocked", "captcha", "denied", "403", "checkpoint"];

function isBlockedError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return BLOCKED_SIGNALS.some((s) => msg.includes(s));
}

async function processLead(
  lead: Lead,
  context: Awaited<ReturnType<typeof openSocialEnrichBrowser>>["context"],
  sleepFn: (ms: number) => Promise<void>
): Promise<{ processed: boolean; error: boolean; blocked: boolean }> {
  const scrapingCfg = getScrapingConfig();
  const page = await context.newPage();
  try {
    const facebookUrl = selectedHeuristicUrl(lead, "facebook");
    const instagramUrl = selectedHeuristicUrl(lead, "instagram");

    if (facebookUrl || instagramUrl) {
      const delayMs = randomBetween(scrapingCfg.social_delay_ms[0], scrapingCfg.social_delay_ms[1]);
      await sleepFn(delayMs);
    }

    const facebook = facebookUrl
      ? await extractFacebookProfile(page, facebookUrl, lead)
      : null;
    const instagram = instagramUrl
      ? await extractInstagramProfile(page, instagramUrl, lead)
      : null;

    const ranAt = new Date().toISOString();
    const socialSearch: PlaywrightSocialSearch = {
      ran_at: ranAt,
      source: "playwright",
      facebook,
      instagram,
    };
    const derived = tagsForResult(facebook, instagram);

    // Tracking de actividad/audiencia social desde el og:description público.
    const activityProfiles: SocialActivityProfile[] = [];
    if (instagram) activityProfiles.push(instagramProfile(instagram.url, instagram.bio));
    if (facebook) activityProfiles.push(facebookProfile(facebook.url, facebook.description));
    const hasWebsite =
      Boolean(lead.website) ||
      Boolean(lead.digital_footprint?.heuristic_discovery?.selected.website?.url);
    const socialActivity =
      activityProfiles.length > 0
        ? buildSocialActivitySnapshot(activityProfiles, { ranAt, hasWebsite })
        : undefined;

    // P1/P3: parsear la descripción social (tel/email/web) y fusionarla a canonical_fields
    // como fuente ponderada por actividad. Best-effort: si algo falla no rompe el enrich.
    let socialCanonical: Record<string, unknown> | null | undefined;
    try {
      const canonicalInputs: SocialCanonicalInput[] = [];
      if (instagram) {
        const parsed = await parseSocialDescription(instagram.bio, "instagram");
        canonicalInputs.push({ profile: instagramProfile(instagram.url, instagram.bio), parsed, recencyDays: null });
      }
      if (facebook) {
        const parsed = await parseSocialDescription(facebook.description, "facebook");
        canonicalInputs.push({ profile: facebookProfile(facebook.url, facebook.description), parsed, recencyDays: null });
      }
      if (canonicalInputs.length > 0) {
        socialCanonical = mergeSocialIntoCanonical(lead, canonicalInputs) ?? undefined;
      }
    } catch (parseErr) {
      getLogger().warn({ leadId: lead.id, err: String(parseErr) }, "social description parse failed");
    }

    await updateLeadSocialSearch(lead.id, socialSearch, derived.tags, derived.whatsapp, socialActivity, socialCanonical);

    // Histórico append-only (best-effort): solo inserta si cambió el estado/audiencia/conteos.
    if (activityProfiles.length > 0) {
      await recordSocialSnapshots(lead.id, activityProfiles, ranAt).catch(() => undefined);
    }
    await updateLeadSocialEnrichStatus(lead.id, "ok");
    return { processed: true, error: false, blocked: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isBlockedError(err)) {
      getLogger().warn({ leadId: lead.id }, "social enrich blocked for lead");
      await updateLeadSocialEnrichStatus(lead.id, "blocked").catch(() => {});
      return { processed: false, error: false, blocked: true };
    }
    getLogger().warn({ leadId: lead.id, err: msg }, "social enrich failed for lead");
    return { processed: false, error: true, blocked: false };
  } finally {
    await page.close();
  }
}

export async function runSocialEnrich(opts: SocialEnrichOptions): Promise<SocialEnrichStats> {
  const log = getLogger();
  const limitCount = opts.limit ?? DEFAULT_LIMIT;
  const loaded = opts.run ? await loadLeadsByRunId(opts.run) : await loadAllLeads();
  const candidates = loaded.filter(hasSocialCandidate);
  const freshSkipped = opts.force
    ? []
    : candidates.filter((lead) => isFreshPlaywrightSearch(lead));
  const selected = candidates
    .filter((lead) => opts.force || !isFreshPlaywrightSearch(lead))
    .slice(0, limitCount);

  log.info(
    {
      scope: opts.run ? "run" : "all",
      runId: opts.run ?? null,
      loaded: loaded.length,
      selected: selected.length,
      skippedFresh: freshSkipped.length,
      concurrency: getConcurrency(),
    },
    "Starting social enrich"
  );

  const scrapingCfg = getScrapingConfig();
  const sleepFn = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  const session = await openSocialEnrichBrowser();
  let processed = 0;
  let errors = 0;
  let blocked = 0;
  try {
    const limit = pLimit(getConcurrency());
    await Promise.all(
      selected.map((lead) =>
        limit(async () => {
          const result = await processLead(lead, session.context, sleepFn);
          if (result.processed) processed += 1;
          if (result.error) errors += 1;
          if (result.blocked) blocked += 1;
        })
      )
    );
  } finally {
    try { await session.context.close(); } catch { /* ignore */ }
    await session.browser.close();
  }

  log.info({ processed, errors, blocked, socialDelayMs: scrapingCfg.social_delay_ms }, "Social enrich complete");

  return {
    loaded: loaded.length,
    selected: selected.length,
    processed,
    skippedFresh: freshSkipped.length,
    errors,
    blocked,
  };
}
