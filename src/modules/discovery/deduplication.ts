import type { DiscoveryCandidate, Lead } from "../../shared/types.js";

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (normA.length === 0 && normB.length === 0) return 1.0;
  if (normA.length === 0 || normB.length === 0) return 0.0;
  const dist = levenshtein(normA, normB);
  return 1 - dist / Math.max(normA.length, normB.length);
}

export function findCrossSourceMatch(
  candidate: DiscoveryCandidate,
  existingLeads: Lead[],
  threshold = 0.85
): Lead | null {
  let best: Lead | null = null;
  let bestSim = -1;

  for (const lead of existingLeads) {
    if (lead.source === candidate.source && lead.external_id === candidate.external_id) continue;

    const sim = nameSimilarity(candidate.name, lead.name);
    if (sim < threshold) continue;

    if (sim > bestSim) {
      best = lead;
      bestSim = sim;
    } else if (sim === bestSim && best !== null) {
      const lScore = lead.prospect_score ?? null;
      const bScore = best.prospect_score ?? null;
      if (lScore !== null && (bScore === null || lScore > bScore)) {
        best = lead;
      } else if (lScore === null && bScore === null && lead.name < best.name) {
        best = lead;
      }
    }
  }

  return best;
}
