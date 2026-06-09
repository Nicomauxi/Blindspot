// Re-score encadenado al enrichment de colección (F2-ext Fase 2): al completar el
// enrich, re-puntúa los mismos leads con su estado post-enrich. Crea un run de
// scoring dependiente (source_run_id = run de enrich) para trazabilidad en Monitoreo.
// Score es puro cómputo (sin red ni Playwright), seguro in-process en la API.
import { getLogger } from "../../shared/logger.js";
import { loadLeadsByIds, updateLeadScore, upsertBuyerScores } from "../../storage/leads.js";
import { createScoringRun, completeScoringRun, failRun } from "../../storage/runs.js";
import { scoreLead } from "../../modules/scoring/index.js";
import { computeAllBuyerScores } from "../../modules/scoring/buyer-types.js";
import { getAdminServicePricing } from "../../storage/service-pricing.js";
import { buildTopBottom } from "./score.js";
import type { Lead, Run, ScoringRunStats } from "../../shared/types.js";

export async function rescoreLeadsChained(
  sourceRun: Run,
  leadIds: string[]
): Promise<{ runId: string; leadsScored: number } | null> {
  if (leadIds.length === 0) return null;

  const log = getLogger();
  const startedAt = Date.now();
  const scoringRun = await createScoringRun({ scope: "run", sourceRun, dryRun: false });

  try {
    // Releer los leads: el estado en memoria del enrich es previo al enriquecimiento.
    const leads = await loadLeadsByIds(leadIds);
    const deliverySystemCostUyu = await getAdminServicePricing("delivery_system");
    const buyerScoreOpts = deliverySystemCostUyu != null ? { deliverySystemCostUyu } : {};

    const scored: Array<{ lead: Lead; prospectScore: number }> = [];
    for (const lead of leads) {
      const result = scoreLead(lead);
      const leadWithScore: Lead = {
        ...lead,
        business_quality_score: result.business_quality_score,
        digital_gap_score: result.digital_gap_score,
        systems_gap_score: result.systems_gap_score,
        prospect_score: result.prospect_score,
        scoring_version: result.scoring_version,
        contact_ready: result.contact_ready,
        score_breakdown: result.score_breakdown as unknown as Record<string, unknown>,
        systems_gap_breakdown: result.systems_gap_breakdown as unknown as Record<string, unknown>,
      };
      const buyerScores = computeAllBuyerScores(leadWithScore, buyerScoreOpts);
      await updateLeadScore(lead.id, result);
      await upsertBuyerScores(lead.id, buyerScores);
      scored.push({ lead, prospectScore: result.prospect_score });
    }

    const stats: ScoringRunStats = {
      command: "score",
      scope: "run",
      source_run_id: sourceRun.id,
      dry_run: false,
      leads_scored: scored.length,
      duration_ms: Date.now() - startedAt,
      ...buildTopBottom(scored),
    };
    await completeScoringRun(scoringRun.id, stats);

    log.info(
      { runId: scoringRun.id, sourceRunId: sourceRun.id, leads_scored: scored.length },
      "Chained re-score completed"
    );
    return { runId: scoringRun.id, leadsScored: scored.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRun(scoringRun.id, msg, Date.now() - startedAt);
    throw err;
  }
}
