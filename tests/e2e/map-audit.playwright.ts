import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env["MAP9_BASE_URL"] ?? "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });

async function stubCommon(page: import("playwright").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "map9-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
    window.localStorage.setItem("blindspot.theme", "dark");
  });

  await page.route('https://*.tile.openstreetmap.org/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/stats/overview', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { total_leads: 2, total_outreach: 0 } }) });
  });
  await page.route('**/api/v1/stats/outreach', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/v1/pipeline/runs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
  });
  await page.route('**/api/v1/discovery/jobs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
  });
  await page.route('**/api/v1/admin/niches/groups**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'niche-1', canonical: 'restaurant', aliases: ['restaurante'], created_at: '2026-05-27T00:00:00Z', updated_at: '2026-05-27T00:00:00Z' }] }) });
  });
  await page.route('**/api/v1/admin/geo/zones**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ zone_id: 'montevideo', departamento: 'Montevideo', ciudad: 'Montevideo', barrio: 'Centro', label: 'Montevideo Centro', kind: 'barrio', lead_count: 2, last_seen_at: '2026-05-27T00:00:00Z' }], total: 1 }) });
  });
}

const homePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await stubCommon(homePage);
await homePage.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'geo upstream unavailable' }) });
});
await homePage.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, has_more: false }) });
});
await homePage.route('**/api/v1/leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, next_cursor: null }) });
});
await homePage.goto(baseUrl + '/admin');
await homePage.getByText('No se pudo cargar el mapa.').waitFor();
assert.equal(await homePage.evaluate(() => document.documentElement.dataset.theme), 'dark');
console.log('MAP-9 Playwright: error visible en Inicio mobile/dark OK');
await homePage.close();

const discoveryPage = await browser.newPage({ viewport: { width: 430, height: 932 } });
await stubCommon(discoveryPage);
await discoveryPage.addInitScript(() => {
  window.localStorage.setItem('blindspot.discovery.composer', JSON.stringify({
    sources: ['yelu', 'mintur'],
    location: 'Montevideo',
    niche: '',
    max_results: '200',
    cpu_budget: 'balanced',
    google_profile: 'B',
    google_concurrency: '5',
    google_cost_cap_usd: '',
    enrich_after_discovery: true,
    geo_selection: {
      label: 'Montevideo Centro · Cuadrícula A',
      parent_location_keys: ['montevideo'],
      grid_location_keys: ['a'],
    },
  }));
});
await discoveryPage.route('**/api/v1/discovery/recommendations**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { coverage_gaps_global: [], coverage_gaps_by_location: [], niche_suggestions: [{ key: 'restaurant', niche: 'restaurant', origin: 'existing_leads' }], top_niches_by_source: [], google_places_budget: null, monthly_cost: 0, location_density: [] } }) });
});
await discoveryPage.route('**/api/v1/discovery/job-batches**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
});
await discoveryPage.route('**/api/v1/admin/discovery/places**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
});
await discoveryPage.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { locations: [{ location_key: 'montevideo::a', location_label: 'Montevideo Centro · Cuadrícula A', parent_location_key: 'montevideo', parent_location_label: 'Montevideo', lead_count: 2, hot_leads_count: 1, avg_prospect_score: 81, commercial_density_score: 92, gps_points: [{ lat: -34.905, lng: -56.191 }], raw_gps_lead_count: 2, geocoded_lead_count: 0, grid_center: { lat: -34.905, lng: -56.191 } }], exact_points: [{ lat: -34.905, lng: -56.191 }], geocoded_points: [], meta: { raw_gps_leads: 2, geocoded_address_leads: 0, unresolved_address_leads: 0, deferred_geocode_leads: 0, filtered_leads: 2, positioned_leads: 2, grid_cell_size_km: 2.2 } } }) });
});
await discoveryPage.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'zone drilldown unavailable' }) });
});
await discoveryPage.goto(baseUrl + '/admin/discovery');
await discoveryPage.waitForSelector('[data-testid="location-density-visible-count"]');
await discoveryPage.getByRole('button', { name: 'Leads individuales' }).click();
const zoneError = discoveryPage.getByTestId('location-density-zone-error');
await zoneError.waitFor();
const zoneErrorText = (await zoneError.textContent())?.trim() ?? '';
assert.ok(zoneErrorText.length > 0);
assert.equal(await discoveryPage.evaluate(() => document.documentElement.dataset.theme), 'dark');
console.log('MAP-9 Playwright: error visible en zone-leads mobile/dark OK');
await discoveryPage.close();

await browser.close();
