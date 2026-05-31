import assert from "node:assert/strict";
import { chromium } from "playwright";

type GpsSource = "real" | "google" | "inferred";

type LeadFixture = {
  id: string;
  name: string;
  source: string;
  niche: string;
  prospect_score: number;
  contact_tier: string;
  gps_source: GpsSource;
  parent_location_key: string;
  parent_location_label: string;
  location_key: string;
  location_label: string;
  lat: number;
  lng: number;
};

type DensityLocation = {
  location_key: string;
  location_label: string;
  parent_location_key: string;
  parent_location_label: string;
  lead_count: number;
  hot_leads_count: number;
  avg_prospect_score: number;
  commercial_density_score: number;
  gps_points: Array<{ lat: number; lng: number }>;
  raw_gps_lead_count: number;
  geocoded_lead_count: number;
  grid_center: { lat: number; lng: number };
};

const baseUrl = process.env["MAP6_BASE_URL"] ?? "http://127.0.0.1:3000";

const leads: LeadFixture[] = [
  { id: "mvd-real-restaurant", name: "Restaurante Centro", source: "yelu", niche: "restaurant", prospect_score: 82, contact_tier: "A", gps_source: "real", parent_location_key: "montevideo", parent_location_label: "Montevideo", location_key: "montevideo-centro::a", location_label: "Montevideo Centro · Cuadrícula A", lat: -34.905, lng: -56.191 },
  { id: "mvd-google-restaurant", name: "Restaurant Google", source: "google_places", niche: "restaurant", prospect_score: 77, contact_tier: "B", gps_source: "google", parent_location_key: "montevideo", parent_location_label: "Montevideo", location_key: "montevideo-centro::a", location_label: "Montevideo Centro · Cuadrícula A", lat: -34.904, lng: -56.19 },
  { id: "mvd-inferred-clinic", name: "Clinica Pocitos", source: "yelu", niche: "clinic", prospect_score: 68, contact_tier: "C", gps_source: "inferred", parent_location_key: "montevideo", parent_location_label: "Montevideo", location_key: "montevideo-pocitos::b", location_label: "Montevideo Pocitos · Cuadrícula B", lat: -34.912, lng: -56.149 },
  { id: "mvd-inferred-hotel", name: "Hotel Pocitos", source: "osm", niche: "hotel", prospect_score: 74, contact_tier: "B", gps_source: "inferred", parent_location_key: "montevideo", parent_location_label: "Montevideo", location_key: "montevideo-pocitos::b", location_label: "Montevideo Pocitos · Cuadrícula B", lat: -34.913, lng: -56.148 },
  { id: "salto-real-restaurant", name: "Restaurante Salto", source: "yelu", niche: "restaurant", prospect_score: 88, contact_tier: "A", gps_source: "real", parent_location_key: "salto", parent_location_label: "Salto", location_key: "salto-centro::c", location_label: "Salto Centro · Cuadrícula C", lat: -31.39, lng: -57.96 },
  { id: "salto-inferred-hotel", name: "Hotel Salto", source: "osm", niche: "hotel", prospect_score: 62, contact_tier: "B", gps_source: "inferred", parent_location_key: "salto", parent_location_label: "Salto", location_key: "salto-centro::c", location_label: "Salto Centro · Cuadrícula C", lat: -31.391, lng: -57.961 },
];

const zones = [
  { zone_id: "montevideo", departamento: "Montevideo", ciudad: "Montevideo", barrio: null, label: "Montevideo", kind: "ciudad", lead_count: 4, last_seen_at: "2026-05-26T00:00:00Z" },
  { zone_id: "salto", departamento: "Salto", ciudad: "Salto", barrio: null, label: "Salto", kind: "ciudad", lead_count: 2, last_seen_at: "2026-05-26T00:00:00Z" },
] as const;

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function filterLeads(url: URL): LeadFixture[] {
  const zoneIds = parseList(url.searchParams.get("zone_ids"));
  const sources = parseList(url.searchParams.get("source"));
  const niche = url.searchParams.get("niche")?.trim().toLowerCase();
  const minScore = Number(url.searchParams.get("prospect_score_gte") ?? "0");
  const tiers = parseList(url.searchParams.get("contact_tier"));
  const gpsSources = parseList(url.searchParams.get("gps_source"));

  return leads.filter((lead) => {
    if (zoneIds && !zoneIds.includes(lead.parent_location_key)) return false;
    if (sources && !sources.includes(lead.source)) return false;
    if (niche && !lead.niche.toLowerCase().includes(niche)) return false;
    if (lead.prospect_score < minScore) return false;
    if (tiers && !tiers.includes(lead.contact_tier)) return false;
    if (gpsSources && !gpsSources.includes(lead.gps_source)) return false;
    return true;
  });
}

function buildDensityResponse(url: URL) {
  const filtered = filterLeads(url);
  const groups = new Map<string, DensityLocation>();
  for (const lead of filtered) {
    const current = groups.get(lead.location_key) ?? {
      location_key: lead.location_key,
      location_label: lead.location_label,
      parent_location_key: lead.parent_location_key,
      parent_location_label: lead.parent_location_label,
      lead_count: 0,
      hot_leads_count: 0,
      avg_prospect_score: 0,
      commercial_density_score: 0,
      gps_points: [],
      raw_gps_lead_count: 0,
      geocoded_lead_count: 0,
      grid_center: { lat: lead.lat, lng: lead.lng },
    };
    current.lead_count += 1;
    if (lead.prospect_score >= 75) current.hot_leads_count += 1;
    current.avg_prospect_score += lead.prospect_score;
    current.gps_points.push({ lat: lead.lat, lng: lead.lng });
    if (lead.gps_source === "inferred") current.geocoded_lead_count += 1;
    else current.raw_gps_lead_count += 1;
    groups.set(lead.location_key, current);
  }

  const locations = Array.from(groups.values())
    .map((location) => ({
      ...location,
      avg_prospect_score: Number((location.avg_prospect_score / location.lead_count).toFixed(1)),
      commercial_density_score: Math.min(100, location.lead_count * 35 + location.hot_leads_count * 15),
    }))
    .sort((left, right) => right.commercial_density_score - left.commercial_density_score || left.location_label.localeCompare(right.location_label, "es"));

  return {
    data: {
      locations,
      exact_points: filtered.filter((lead) => lead.gps_source !== "inferred").map((lead) => ({ lat: lead.lat, lng: lead.lng })),
      geocoded_points: filtered.filter((lead) => lead.gps_source === "inferred").map((lead) => ({ lat: lead.lat, lng: lead.lng })),
      meta: {
        raw_gps_leads: filtered.filter((lead) => lead.gps_source !== "inferred").length,
        geocoded_address_leads: filtered.filter((lead) => lead.gps_source === "inferred").length,
        unresolved_address_leads: 0,
        deferred_geocode_leads: 0,
        filtered_leads: filtered.length,
        positioned_leads: filtered.length,
        grid_cell_size_km: 2.2,
      },
    },
  };
}

function buildZoneLeadsResponse(url: URL) {
  const filtered = filterLeads(url);
  const locationKey = url.searchParams.get("location_key");
  const parentKey = url.searchParams.get("parent_location_key");
  const gridKey = url.searchParams.get("grid_location_key");
  const selected = filtered.filter((lead) => {
    if (locationKey && lead.location_key === locationKey) return true;
    if (parentKey && gridKey && lead.parent_location_key === parentKey && lead.location_key.endsWith("::" + gridKey)) return true;
    if (locationKey && !locationKey.includes("::") && lead.parent_location_key === locationKey) return true;
    return false;
  });
  return {
    data: selected.map((lead) => ({ id: lead.id, name: lead.name, niche: lead.niche, contact_tier: lead.contact_tier, prospect_score: lead.prospect_score, address: lead.location_label, gps: { lat: lead.lat, lng: lead.lng }, map_point: { lat: lead.lat, lng: lead.lng }, source: lead.source })),
    total: selected.length,
    has_more: false,
  };
}

function buildZonesResponse(url: URL) {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const filtered = zones.filter((zone) => !q || zone.label.toLowerCase().includes(q));
  return { data: filtered, total: filtered.length };
}

async function setRangeValue(page: import("playwright").Page, value: number) {
  await page.locator('input[type="range"]').first().evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, String(nextValue));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitForMap(page: import("playwright").Page) {
  await page.waitForSelector('[data-testid="location-density-visible-count"]');
  await page.waitForTimeout(600);
}

async function expectState(page: import("playwright").Page, expectedZones: number, expectedLeads?: number) {
  await page.waitForTimeout(450);
  const summary = await page.getByTestId('location-density-visible-count').textContent();
  assert.equal(summary, String(expectedZones) + " cuadrículas visibles");
  assert.equal(await page.getByTestId('location-density-list-item').count(), expectedZones);

  if (expectedZones === 0) {
    await assert.doesNotReject(async () => page.getByTestId('location-density-empty').waitFor({ state: 'visible' }));
    return;
  }

  if (typeof expectedLeads === 'number') {
    await page.getByRole('button', { name: 'Leads individuales' }).click();
    await page.getByTestId('location-density-list-item').first().click();
    await page.waitForTimeout(450);
  }
}

const scenarios = [
  { name: 'sin filtros', apply: async (_page: import("playwright").Page) => {}, expectedZones: 3, expectedLeads: 2 },
  { name: 'solo zona', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); }, expectedZones: 2, expectedLeads: 2 },
  { name: 'zona + source', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await page.getByRole('button', { name: 'yelu' }).first().click(); }, expectedZones: 2, expectedLeads: 1 },
  { name: 'zona + niche', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await page.getByPlaceholder('restaurante, clínica, hotel...').fill('restaurant'); }, expectedZones: 1, expectedLeads: 2 },
  { name: 'zona + score mínimo', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await setRangeValue(page, 80); }, expectedZones: 1, expectedLeads: 1 },
  { name: 'zona + tier', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await page.getByRole('button', { name: 'B' }).first().click(); }, expectedZones: 2, expectedLeads: 1 },
  { name: 'zona + gps_source', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await page.getByRole('button', { name: 'Inferido' }).click(); }, expectedZones: 1, expectedLeads: 2 },
  { name: 'source + niche + score + tier', apply: async (page: import("playwright").Page) => { await page.getByRole('button', { name: 'yelu' }).first().click(); await page.getByPlaceholder('restaurante, clínica, hotel...').fill('restaurant'); await setRangeValue(page, 80); await page.getByRole('button', { name: 'A' }).first().click(); }, expectedZones: 2, expectedLeads: 1 },
  { name: 'todos los filtros con resultados', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await page.getByRole('button', { name: 'yelu' }).first().click(); await page.getByPlaceholder('restaurante, clínica, hotel...').fill('restaurant'); await setRangeValue(page, 80); await page.getByRole('button', { name: 'A' }).first().click(); await page.getByRole('button', { name: 'Real' }).click(); }, expectedZones: 1, expectedLeads: 1 },
  { name: 'todos los filtros sin resultados', apply: async (page: import("playwright").Page) => { await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click(); await page.getByRole('button', { name: 'yelu' }).first().click(); await page.getByPlaceholder('restaurante, clínica, hotel...').fill('restaurant'); await setRangeValue(page, 90); await page.getByRole('button', { name: 'A' }).first().click(); await page.getByRole('button', { name: 'Real' }).click(); }, expectedZones: 0 },
] as const;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

await page.addInitScript(() => {
  window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "map6-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
});

await page.route('https://*.tile.openstreetmap.org/**', async (route) => {
  await route.fulfill({ status: 204, body: '' });
});
await page.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDensityResponse(url)) });
});
await page.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildZoneLeadsResponse(url)) });
});
await page.route('**/api/v1/admin/geo/zones**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildZonesResponse(url)) });
});
await page.route('**/api/v1/discovery/recommendations**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { coverage_gaps_global: [], coverage_gaps_by_location: [], niche_suggestions: [{ key: 'restaurant', niche: 'restaurant', origin: 'existing_leads' }, { key: 'clinic', niche: 'clinic', origin: 'existing_leads' }, { key: 'hotel', niche: 'hotel', origin: 'existing_leads' }], top_niches_by_source: [], google_places_budget: null, monthly_cost: 0, location_density: [] } }) });
});
await page.route('**/api/v1/discovery/job-batches**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
});
await page.route('**/api/v1/discovery/jobs**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
});
await page.route('**/api/v1/admin/discovery/places**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
});

for (const scenario of scenarios) {
  await page.goto(baseUrl + '/admin/discovery');
  await waitForMap(page);
  await scenario.apply(page);
  await expectState(page, scenario.expectedZones, scenario.expectedLeads);
  console.log('MAP-6 Playwright:', scenario.name, 'OK');
}

await browser.close();
