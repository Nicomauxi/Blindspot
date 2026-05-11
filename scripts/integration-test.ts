/**
 * Integration test against local Supabase.
 * Bypasses Google Places (no API key needed) — uses realistic fixtures.
 * Proves: run lifecycle, lead upsert, dedup, idempotency.
 *
 * Usage: pnpm test:integration
 * Requires: Supabase local running + .env with all vars
 * Warning: mutates DB, no cleanup — manual use only
 */

import { applyProfileFilter, tagCandidate } from "../src/modules/discovery/filters.js";
import { getDiscoveryConfig, getProfileConfig } from "../src/modules/discovery/config.js";
import { createRun, completeRun, failRun } from "../src/storage/runs.js";
import { upsertLeads } from "../src/storage/leads.js";
import { getSupabase } from "../src/shared/supabase.js";
import type { PlaceCandidate, DiscoveryProfile, RunStats } from "../src/shared/types.js";

// ---- Fixtures (realistic Places API responses for "peluquería Montevideo") ---

const FAKE_PLACES: PlaceCandidate[] = [
  {
    placeId: "ChIJtest_001_peluqueria",
    name: "Peluquería La Paloma",
    formattedAddress: "Av. 18 de Julio 1234, Montevideo, Uruguay",
    rating: 4.7,
    userRatingCount: 35,
    websiteUri: "https://www.facebook.com/peluqueriapaloma",
    phone: "+59899123456",
    businessStatus: "OPERATIONAL",
    raw: { source: "fixture" },
  },
  {
    placeId: "ChIJtest_002_peluqueria",
    name: "Cortes & Colores Beatriz",
    formattedAddress: "Bulevar Artigas 500, Montevideo, Uruguay",
    rating: 4.5,
    userRatingCount: 28,
    websiteUri: null,
    phone: "+59899654321",
    businessStatus: "OPERATIONAL",
    raw: { source: "fixture" },
  },
  {
    placeId: "ChIJtest_003_peluqueria",
    name: "Estudio Capelli",
    formattedAddress: "Luis Lamas 1800, Montevideo, Uruguay",
    rating: 4.4,
    userRatingCount: 42,
    websiteUri: "https://linktr.ee/studiocapelli",
    phone: "+59891111222",
    businessStatus: "OPERATIONAL",
    raw: { source: "fixture" },
  },
  {
    placeId: "ChIJtest_004_peluqueria",
    name: "Salon Élite",
    formattedAddress: "Rambla República de México 5400, Montevideo",
    rating: 4.8,
    userRatingCount: 120,  // too many for profile A
    websiteUri: null,
    phone: "+59892345678",
    businessStatus: "OPERATIONAL",
    raw: { source: "fixture" },
  },
  {
    placeId: "ChIJtest_005_peluqueria",
    name: "Peluquería Don Carlos",
    formattedAddress: "Garibaldi 2400, Montevideo",
    rating: 3.8,  // too low for profile A
    userRatingCount: 15,
    websiteUri: null,
    phone: null,
    businessStatus: "OPERATIONAL",
    raw: { source: "fixture" },
  },
  {
    placeId: "ChIJtest_006_peluqueria",
    name: "Hair Studio Montevideo",
    formattedAddress: "Comercio 1450, Ciudad Vieja, Montevideo",
    rating: 4.6,
    userRatingCount: 19,
    websiteUri: "https://beacons.ai/hairstudiomvd",
    phone: "+59899777888",
    businessStatus: "OPERATIONAL",
    raw: { source: "fixture" },
  },
];

// ---- Helpers ---------------------------------------------------------------

async function showRun(runId: string): Promise<void> {
  const db = getSupabase();

  const { data: run } = await db
    .from("runs")
    .select("id, status, niche, location, profile, config, stats, started_at, finished_at")
    .eq("id", runId)
    .single();

  console.log("\n=== runs (latest) ===");
  console.table([run]);
}

async function showLeads(runId: string): Promise<void> {
  const db = getSupabase();

  const { data: leads } = await db
    .from("leads")
    .select("place_id, name, rating, review_count, website, first_seen_run_id, state, tags, passed_filter")
    .eq("last_seen_run_id", runId);

  console.log(`\n=== leads for run ${runId} ===`);
  console.table(leads);
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const profileName: DiscoveryProfile = "a";
  const niche = "peluquería";
  const location = "Montevideo Uruguay";
  const startedAt = Date.now();

  const discoveryConfig = getDiscoveryConfig();
  const profileConfig = getProfileConfig(profileName);

  console.log("=".repeat(60));
  console.log("gap-radar integration test — local Supabase");
  console.log("=".repeat(60));
  console.log(`Profile: ${profileName} | Niche: ${niche} | Location: ${location}`);
  console.log(`Fixture candidates: ${FAKE_PLACES.length}`);

  // ---- RUN 1 ---------------------------------------------------------------
  console.log("\n--- RUN 1 (first discovery, should create new leads) ---");

  const run1 = await createRun({
    niche,
    location,
    profile: profileName,
    maxResults: 10,
    config: { max_results: 10, profile_thresholds: profileConfig, overrides: {} },
  });
  console.log(`Run created: ${run1.id}  status=${run1.status}`);

  const { passed: filtered1, rejected: rejected1 } = applyProfileFilter(
    FAKE_PLACES,
    profileConfig,
    discoveryConfig.social_domains
  );
  console.log(`Filtered: ${FAKE_PLACES.length} → ${filtered1.length} passed / ${rejected1.length} rejected`);
  filtered1.forEach((c) => console.log(`  ✓ ${c.name} (rating=${c.rating}, reviews=${c.userRatingCount}, web=${c.websiteUri ?? "null"})`));

  const items1 = [
    ...filtered1.map((c) => ({ candidate: c, passed: true, rejection_reasons: [] as string[] })),
    ...rejected1.map(({ candidate, reasons }) => ({ candidate, passed: false, rejection_reasons: reasons as string[] })),
  ];

  const { inserted: ins1, updated: upd1 } = await upsertLeads(
    items1,
    run1.id,
    profileName,
    (c) => tagCandidate(c, profileName, discoveryConfig.social_domains)
  );

  const dur1 = Date.now() - startedAt;
  const stats1: RunStats = {
    places_requests: FAKE_PLACES.length,
    estimated_cost_usd: 0,
    leads_discovered: filtered1.length,
    leads_new: ins1.length,
    leads_updated: upd1.length,
    leads_rejected: rejected1.length,
    duration_ms: dur1,
  };
  await completeRun(run1.id, stats1);

  console.log(`\nInserted: ${ins1.length}  Updated: ${upd1.length}  Rejected: ${rejected1.length}  duration_ms: ${dur1}`);
  await showRun(run1.id);
  await showLeads(run1.id);

  // ---- RUN 2 (idempotency) -------------------------------------------------
  console.log("\n--- RUN 2 (same data — dedup check, first_seen_run_id must stay unchanged) ---");

  const run2Start = Date.now();
  const run2 = await createRun({
    niche,
    location,
    profile: profileName,
    maxResults: 10,
    config: { max_results: 10, profile_thresholds: profileConfig, overrides: {} },
  });
  console.log(`Run created: ${run2.id}  status=${run2.status}`);

  const { passed: filtered2, rejected: rejected2 } = applyProfileFilter(
    FAKE_PLACES,
    profileConfig,
    discoveryConfig.social_domains
  );
  const items2 = [
    ...filtered2.map((c) => ({ candidate: c, passed: true, rejection_reasons: [] as string[] })),
    ...rejected2.map(({ candidate, reasons }) => ({ candidate, passed: false, rejection_reasons: reasons as string[] })),
  ];
  const { inserted: ins2, updated: upd2 } = await upsertLeads(
    items2,
    run2.id,
    profileName,
    (c) => tagCandidate(c, profileName, discoveryConfig.social_domains)
  );

  const dur2 = Date.now() - run2Start;
  await completeRun(run2.id, {
    places_requests: FAKE_PLACES.length,
    estimated_cost_usd: 0,
    leads_discovered: filtered2.length,
    leads_new: ins2.length,
    leads_updated: upd2.length,
    leads_rejected: rejected2.length,
    duration_ms: dur2,
  });

  console.log(`\nInserted: ${ins2.length}  Updated: ${upd2.length}  duration_ms: ${dur2}`);
  console.log("→ Expected: inserted=0, updated=6 (all already existed including rejected)");

  await showRun(run2.id);

  // Verify first_seen_run_id is still run1's id (not run2)
  const db = getSupabase();
  const { data: dedupCheck } = await db
    .from("leads")
    .select("place_id, name, first_seen_run_id, last_seen_run_id")
    .in("place_id", FAKE_PLACES.map((c) => c.placeId));

  console.log("\n=== dedup verification: first_seen_run_id must equal run1 ===");
  (dedupCheck ?? []).forEach((row) => {
    const ok = row.first_seen_run_id === run1.id ? "✅" : "❌";
    console.log(`  ${ok} ${row.name}: first_seen=${row.first_seen_run_id === run1.id ? "run1" : "WRONG"}, last_seen=${row.last_seen_run_id === run2.id ? "run2" : "run1"}`);
  });

  // ---- RUN 3 (failure path) ------------------------------------------------
  console.log("\n--- RUN 3 (simulated failure — status must be 'failed') ---");

  const run3Start = Date.now();
  const run3 = await createRun({
    niche,
    location,
    profile: profileName,
    maxResults: 10,
    config: { max_results: 10 },
  });
  console.log(`Run created: ${run3.id}  status=${run3.status}`);

  await failRun(run3.id, "Simulated error: Places API quota exceeded", Date.now() - run3Start);

  const { data: failedRun } = await db.from("runs").select("id, status, stats").eq("id", run3.id).single();
  const failedStats = failedRun?.stats as { error?: string } | null;
  console.log(`\nFailed run: status=${failedRun?.status}  error="${failedStats?.error}"`);
  console.log(failedRun?.status === "failed" ? "✅ status=failed" : "❌ status should be failed");

  // ---- Final summary -------------------------------------------------------
  const { data: allRuns } = await db.from("runs").select("id, status, stats, started_at").order("started_at");
  console.log("\n=== all runs (final state) ===");
  console.table(allRuns);

  const { data: allLeads } = await db
    .from("leads")
    .select("place_id, name, rating, state, tags, passed_filter, rejection_reasons, first_seen_run_id")
    .order("passed_filter", { ascending: false });
  console.log("\n=== all leads (final state) ===");
  console.table(allLeads);

  console.log("\n" + "=".repeat(60));
  console.log("Integration test COMPLETE");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
