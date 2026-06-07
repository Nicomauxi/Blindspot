// Derivación de métricas temporales a partir del histórico de snapshots sociales.
// Reglas: con <2 puntos válidos las tasas son null (honesto). Se saltan puntos con
// métrica null (parse fallido) en vez de tratarlos como 0 (evita churn espurio).

export interface SocialSnapshotPoint {
  captured_at: string;
  followers: number | null;
  posts: number | null;
  likes: number | null;
  talking_about: number | null;
  activity_status: string | null;
}

export interface SocialDerivedMetrics {
  followers_growth_30d: { abs: number; pct: number | null } | null;
  posts_per_month: number | null;
  churn_risk: boolean;
  engagement_trend: number | null;
  // Días desde la última captura (recencia del dato). null si no hay capturas.
  recency_days: number | null;
  // Engagement aproximado FB (talking_about / likes) de la última captura. null si no aplica.
  engagement_ratio: number | null;
  series: Array<{ captured_at: string; followers: number | null }>;
  point_count: number;
}

const DAY_MS = 86_400_000;

function ts(iso: string): number {
  return Date.parse(iso);
}

// Punto válido más cercano a (referencia - windowDays), dentro de una tolerancia.
function pointNearWindow(
  points: SocialSnapshotPoint[],
  refMs: number,
  windowDays: number,
  toleranceDays: number,
  pick: (p: SocialSnapshotPoint) => number | null
): SocialSnapshotPoint | null {
  const targetMs = refMs - windowDays * DAY_MS;
  const tolMs = toleranceDays * DAY_MS;
  let best: SocialSnapshotPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (pick(p) == null) continue;
    const dist = Math.abs(ts(p.captured_at) - targetMs);
    if (dist <= tolMs && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

export function deriveSocialMetrics(
  snapshots: SocialSnapshotPoint[],
  opts: { nowIso: string; windowDays?: number; toleranceDays?: number }
): SocialDerivedMetrics {
  const windowDays = opts.windowDays ?? 30;
  const toleranceDays = opts.toleranceDays ?? 10;
  const sorted = snapshots
    .filter((s) => Number.isFinite(ts(s.captured_at)))
    .slice()
    .sort((a, b) => ts(a.captured_at) - ts(b.captured_at));

  const series = sorted.map((s) => ({ captured_at: s.captured_at, followers: s.followers }));

  // followers_growth: último punto con followers vs punto ~windowDays antes.
  const withFollowers = sorted.filter((s) => s.followers != null);
  let followers_growth_30d: SocialDerivedMetrics["followers_growth_30d"] = null;
  if (withFollowers.length >= 2) {
    const last = withFollowers[withFollowers.length - 1]!;
    const prior = pointNearWindow(withFollowers.slice(0, -1), ts(last.captured_at), windowDays, toleranceDays, (p) => p.followers)
      ?? withFollowers[0]!;
    if (prior !== last) {
      const abs = (last.followers as number) - (prior.followers as number);
      const pct = (prior.followers as number) > 0 ? Number(((abs / (prior.followers as number)) * 100).toFixed(1)) : null;
      followers_growth_30d = { abs, pct };
    }
  }

  // posts_per_month real: (posts_last - posts_first) / meses entre, con ≥2 puntos.
  const withPosts = sorted.filter((s) => s.posts != null);
  let posts_per_month: number | null = null;
  if (withPosts.length >= 2) {
    const first = withPosts[0]!;
    const last = withPosts[withPosts.length - 1]!;
    const months = (ts(last.captured_at) - ts(first.captured_at)) / (30 * DAY_MS);
    if (months > 0) {
      posts_per_month = Number((((last.posts as number) - (first.posts as number)) / months).toFixed(1));
    }
  }

  // churn_risk: alguna transición active -> abandoned en la serie.
  let churn_risk = false;
  const statuses = sorted.map((s) => s.activity_status).filter((v): v is string => v != null);
  for (let i = 1; i < statuses.length; i++) {
    if (statuses[i - 1] === "active" && statuses[i] === "abandoned") churn_risk = true;
  }

  // engagement_trend: delta de talking_about entre los dos últimos no-null.
  const withTalking = sorted.filter((s) => s.talking_about != null);
  let engagement_trend: number | null = null;
  if (withTalking.length >= 2) {
    const a = withTalking[withTalking.length - 2]!;
    const b = withTalking[withTalking.length - 1]!;
    engagement_trend = (b.talking_about as number) - (a.talking_about as number);
  }

  // recency_days: días desde la última captura.
  let recency_days: number | null = null;
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1]!;
    const nowMs = ts(opts.nowIso);
    if (Number.isFinite(nowMs)) {
      recency_days = Math.max(0, Math.round((nowMs - ts(last.captured_at)) / DAY_MS));
    }
  }

  // engagement_ratio (FB): talking_about / likes de la última captura con ambos datos.
  let engagement_ratio: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i]!;
    if (s.likes != null && s.likes > 0 && s.talking_about != null) {
      engagement_ratio = Number((s.talking_about / s.likes).toFixed(4));
      break;
    }
  }

  return {
    followers_growth_30d,
    posts_per_month,
    churn_risk,
    engagement_trend,
    recency_days,
    engagement_ratio,
    series,
    point_count: sorted.length,
  };
}
