import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env["LEAD6_BASE_URL"] ?? "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const requestLog: string[] = [];

const baseLeads = [
  {
    id: "lead-marketing",
    name: "Lead marketing",
    niche: "restaurant",
    source: "google_places",
    canonical_source: "google_places",
    address: "Montevideo, Uruguay",
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    rating: 4.5,
    review_count: 80,
    tags: ["web-only-no-social"],
    state: "discovered",
    prospect_score: 71,
    contact_tier: "A",
    primary_offer: "marketing",
    pitch_hook: "Sin presencia social suficiente.",
    urgency_signal: "medium",
    contacted_by: null,
    created_at: "2026-01-04T00:00:00Z",
    corroborating_sources: [],
    top_buyer_type: null,
    top_buyer_score: null,
    owner_group_id: null,
    source_confidence: 0.8,
    data_confidence_score: 0.8,
    contact_reliability_score: 0.6,
    contact_ready: false,
    commercial_offers_summary: {
      primary_offer_type: "marketing",
      software_score: 4,
      marketing_score: 55,
      top_software_offer: "software",
      top_marketing_offer: "marketing",
      top_software_label: "Sistema de gestión",
      top_marketing_label: "Marketing y redes sociales",
      evidence_count: 2,
    },
  },
  {
    id: "lead-software-alto",
    name: "Lead software alto",
    niche: "restaurant",
    source: "google_places",
    canonical_source: "google_places",
    address: "Punta del Este, Uruguay",
    phone: "+59899111222",
    whatsapp: "+59899111222",
    email: "hola@example.com",
    website: "https://example.com",
    rating: 4.8,
    review_count: 140,
    tags: ["whatsapp-missing"],
    state: "discovered",
    prospect_score: 84,
    contact_tier: "A",
    primary_offer: "software_pos",
    pitch_hook: "Señal fuerte para digitalizar operación.",
    urgency_signal: "high",
    contacted_by: null,
    created_at: "2026-01-03T00:00:00Z",
    corroborating_sources: [],
    top_buyer_type: null,
    top_buyer_score: null,
    owner_group_id: null,
    source_confidence: 0.9,
    data_confidence_score: 0.9,
    contact_reliability_score: 0.8,
    contact_ready: true,
    commercial_offers_summary: {
      primary_offer_type: "software",
      software_score: 88,
      marketing_score: 8,
      top_software_offer: "software",
      top_marketing_offer: "marketing",
      top_software_label: "Sistema de gestión",
      top_marketing_label: "Marketing y redes sociales",
      evidence_count: 3,
    },
  },
  {
    id: "lead-mixto",
    name: "Lead mixto",
    niche: "hotel",
    source: "yelu",
    canonical_source: "yelu",
    address: "Colonia, Uruguay",
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    rating: 4.2,
    review_count: 60,
    tags: ["web-only-no-social", "whatsapp-missing"],
    state: "discovered",
    prospect_score: 69,
    contact_tier: "B",
    primary_offer: "software",
    pitch_hook: "Hay ángulo mixto de software y visibilidad.",
    urgency_signal: "low",
    contacted_by: null,
    created_at: "2026-01-02T00:00:00Z",
    corroborating_sources: [],
    top_buyer_type: null,
    top_buyer_score: null,
    owner_group_id: null,
    source_confidence: 0.7,
    data_confidence_score: 0.7,
    contact_reliability_score: 0.4,
    contact_ready: false,
    commercial_offers_summary: {
      primary_offer_type: "both",
      software_score: 44,
      marketing_score: 39,
      top_software_offer: "software",
      top_marketing_offer: "marketing",
      top_software_label: "Sistema de gestión",
      top_marketing_label: "Marketing y redes sociales",
      evidence_count: 4,
    },
  },
];

await page.addInitScript(() => {
  window.localStorage.setItem(
    "blindspot-auth",
    JSON.stringify({ state: { token: "lead6-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 })
  );
});

await page.route("**/api/v1/alerts/unread-count**", async (route) => {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { count: 0 } }) });
});

await page.route("**/api/v1/leads**", async (route) => {
  const url = new URL(route.request().url());
  requestLog.push(url.search);
  const offerType = url.searchParams.get("commercial_offer_type");
  const sortBy = url.searchParams.get("sort_by");

  let data = [...baseLeads];
  if (offerType) {
    data = data.filter((lead) => lead.commercial_offers_summary.primary_offer_type === offerType);
  }
  if (sortBy === "software_score") {
    data.sort((a, b) => b.commercial_offers_summary.software_score - a.commercial_offers_summary.software_score);
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data, next_cursor: null, total: data.length }),
  });
});

await page.goto(baseUrl + "/admin/leads");
await page.getByText("Lead Explorer").waitFor();
await page.getByRole("link", { name: "Lead marketing" }).waitFor();
await page.locator("span").filter({ hasText: /^Marketing \+ Software$/ }).waitFor();
console.log("LEAD-6 Playwright: badges comerciales visibles OK");

await page.locator('select').first().selectOption('marketing');
await page.getByRole("link", { name: "Lead marketing" }).waitFor();
await page.getByText("Mostrando 1-1 de 1 leads").waitFor();
assert.equal(requestLog.some((entry) => entry.includes("commercial_offer_type=marketing")), true);
console.log("LEAD-6 Playwright: filtro comercial marketing via backend OK");

await page.locator('select').first().selectOption('');
await page.getByText("Mostrando 1-3 de 3 leads").waitFor();

await page.locator('select').nth(1).selectOption('software_score:desc');
await page.getByRole("link", { name: "Lead software alto" }).waitFor();
const firstLeadName = (await page.locator('a[href^="/admin/leads/"]').first().textContent())?.trim();
assert.equal(firstLeadName, "Lead software alto");
assert.equal(requestLog.some((entry) => entry.includes("sort_by=software_score")), true);
console.log("LEAD-6 Playwright: orden por software score via backend OK");

await browser.close();
