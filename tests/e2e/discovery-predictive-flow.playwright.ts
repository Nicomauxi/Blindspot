import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env["DISC14_BASE_URL"] ?? "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1280 } });

let lastBatchPayload: any = null;
let lastBulkPayload: any = null;

await page.addInitScript(() => {
  window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "disc14-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
});

await page.route('https://*.tile.openstreetmap.org/**', async (route) => {
  await route.fulfill({ status: 204, body: '' });
});
await page.route('**/api/v1/alerts/unread-count**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { count: 0 } }) });
});
await page.route('**/api/v1/discovery/job-batches**', async (route) => {
  if (route.request().method() === 'POST') {
    lastBatchPayload = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'batch-1', status: 'queued', jobs: [] } }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
});
await page.route('**/api/v1/discovery/jobs/bulk**', async (route) => {
  lastBulkPayload = route.request().postDataJSON();
  await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { ids: ['bulk-1'], count: 1, total_estimated_cost_usd: 1.29 } }) });
});
await page.route('**/api/v1/discovery/jobs**', async (route) => {
  if (route.request().url().includes('/api/v1/discovery/jobs/bulk')) {
    await route.fallback();
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, total: 0 }) });
});
await page.route('**/api/v1/discovery/recommendations**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        coverage_gaps_global: [],
        coverage_gaps_by_location: [],
        niche_suggestions: [{ key: 'recent:restaurant', niche: 'restaurant', origin: 'recent_discovery', count: 4 }],
        top_niches_by_source: [{ source: 'yelu', niches: [{ niche: 'restaurant', count: 4 }] }],
        google_places_budget: { budget_total: 200, budget_spent: 30, budget_remaining: 170, alert_threshold: 10, over_alert: false },
        monthly_cost: 12.5,
        location_density: [],
      },
    }),
  });
});
await page.route('**/api/v1/discovery/location-suggestions**', async (route) => {
  const url = new URL(route.request().url());
  const city = url.searchParams.get('ciudad');
  const data = city === 'Montevideo'
    ? [
        {
          catalog_entry: { id: 'catalog-pocitos', location_key: 'pocitos', display_name: 'Pocitos', parent_location: 'Montevideo', kind: 'barrio', lat_approx: -34.91, lng_approx: -56.15, commercial_score: 92, notes: null, source: 'xls_import', imported_at: '2026-05-27T00:00:00Z' },
          niche: 'restaurant', score: 81, confidence: 'medium', expected_new_leads: 4.2, duplicate_risk: 0.22, cost_estimate: 1.45,
          reasons: ['Cobertura actual baja (1 leads registrados).', 'La señal histórica se heredó desde Montevideo; confianza más baja.'],
          historical_metrics: { jobs_count: 2, candidates_seen: 32, new_leads_count: 10, duplicate_count: 7, success_rate: 0.31, duplicate_rate: 0.22, avg_cost_per_new_lead: 0.35, last_discovery_at: '2026-03-20T10:00:00Z', coverage_lead_count: 1, historical_scope: 'parent', inherited_from: ['Montevideo'] },
        },
        {
          catalog_entry: { id: 'catalog-centro', location_key: 'centro-mvd', display_name: 'Centro', parent_location: 'Montevideo', kind: 'barrio', lat_approx: -34.9, lng_approx: -56.19, commercial_score: 77, notes: null, source: 'xls_import', imported_at: '2026-05-27T00:00:00Z' },
          niche: 'restaurant', score: 68, confidence: 'low', expected_new_leads: 2.4, duplicate_risk: 0.4, cost_estimate: 1.2,
          reasons: ['Sin histórico suficiente en la zona; queda como exploración controlada apoyada por el catálogo.'],
          historical_metrics: { jobs_count: 0, candidates_seen: 0, new_leads_count: 0, duplicate_count: 0, success_rate: 0, duplicate_rate: 0, avg_cost_per_new_lead: null, last_discovery_at: null, coverage_lead_count: 0, historical_scope: 'none', inherited_from: [] },
        },
      ]
    : [
        {
          catalog_entry: { id: 'catalog-mvd', location_key: 'montevideo', display_name: 'Montevideo', parent_location: null, kind: 'ciudad', lat_approx: -34.9, lng_approx: -56.2, commercial_score: 88, notes: null, source: 'xls_import', imported_at: '2026-05-27T00:00:00Z' },
          niche: null, score: 79, confidence: 'medium', expected_new_leads: 5, duplicate_risk: 0.18, cost_estimate: 1.29,
          reasons: ['Éxito histórico sólido: 38% de leads nuevos sobre candidatos vistos.'],
          historical_metrics: { jobs_count: 3, candidates_seen: 40, new_leads_count: 15, duplicate_count: 7, success_rate: 0.38, duplicate_rate: 0.18, avg_cost_per_new_lead: 0.26, last_discovery_at: '2026-03-10T10:00:00Z', coverage_lead_count: 2, historical_scope: 'direct', inherited_from: [] },
        },
        {
          catalog_entry: { id: 'catalog-salto', location_key: 'salto', display_name: 'Salto', parent_location: null, kind: 'ciudad', lat_approx: -31.39, lng_approx: -57.96, commercial_score: 72, notes: null, source: 'xls_import', imported_at: '2026-05-27T00:00:00Z' },
          niche: null, score: 63, confidence: 'low', expected_new_leads: 2.9, duplicate_risk: 0.31, cost_estimate: 1.18,
          reasons: ['Cobertura actual baja (0 leads registrados).'],
          historical_metrics: { jobs_count: 1, candidates_seen: 18, new_leads_count: 5, duplicate_count: 6, success_rate: 0.28, duplicate_rate: 0.31, avg_cost_per_new_lead: 0.41, last_discovery_at: '2026-02-14T10:00:00Z', coverage_lead_count: 0, historical_scope: 'direct', inherited_from: [] },
        },
      ];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length }) });
});
await page.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { locations: [], exact_points: [], geocoded_points: [], meta: { raw_gps_leads: 0, geocoded_address_leads: 0, unresolved_address_leads: 0, deferred_geocode_leads: 0, filtered_leads: 0, positioned_leads: 0, grid_cell_size_km: 2.2 } } }) });
});
await page.route('**/api/v1/admin/geo/zones**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
});
await page.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, has_more: false }) });
});
await page.route('**/api/v1/admin/performance/niche-alias-groups**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
});
await page.route('**/api/v1/admin/discovery/places**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
});

await page.goto(baseUrl + '/admin/discovery');
await page.getByText('Workspace de discovery').waitFor();

// El composer arranca con la ubicación por defecto (freetext "Montevideo"), sin contexto predictivo.
await page.getByRole('button', { name: 'Crear batch' }).click();
assert.equal(lastBatchPayload.location, 'Montevideo');
assert.equal(lastBatchPayload.predictive_context, undefined);
console.log('DISC-14 Playwright: flujo manual (ubicación default) OK');

// Picker del composer: tab Predictivo + seed de ciudad -> sugerencias del catálogo.
const composerPicker = page.getByTestId('composer-location');
await composerPicker.getByRole('button', { name: 'Predictivo' }).click();
await composerPicker.getByPlaceholder(/Ciudad base/i).fill('Montevideo');
const composerPredictive = page.getByTestId('composer-location-predictive');
await composerPredictive.getByRole('button', { name: /Pocitos/ }).first().waitFor();
console.log('DISC-14 Playwright: tab predictivo muestra sugerencias OK');

// Seleccionar y deseleccionar (single mode) deja el batch sin ubicación.
await composerPredictive.getByRole('button', { name: /Pocitos/ }).first().click();
await composerPredictive.getByRole('button', { name: /Pocitos/ }).first().click();
await page.getByRole('button', { name: 'Crear batch' }).waitFor();
assert.equal(await page.getByRole('button', { name: 'Crear batch' }).isDisabled(), true);
console.log('DISC-14 Playwright: deseleccionar sugerencia evita creación OK');

await composerPredictive.getByRole('button', { name: /Pocitos/ }).first().click();
await page.getByRole('button', { name: 'Crear batch' }).click();
assert.equal(lastBatchPayload.recommendation_origin.type, 'predictive_location');
assert.equal(lastBatchPayload.predictive_context.location_catalog_entry_id, 'catalog-pocitos');
assert.equal(lastBatchPayload.location, 'Pocitos');
console.log('DISC-14 Playwright: batch guarda metadata predictiva OK');

// Creación masiva: nicho + ubicación predictiva del catálogo.
await page.getByRole('button', { name: 'restaurante' }).click();
const bulkPicker = page.getByTestId('bulk-location');
await bulkPicker.getByRole('button', { name: 'Predictivo' }).click();
const bulkPredictive = page.getByTestId('bulk-location-predictive');
await bulkPredictive.getByRole('button', { name: /Montevideo/ }).first().click();
await page.getByRole('button', { name: /Crear lote/ }).click();
await page.getByText(/jobs creados/i).waitFor();
assert.equal(lastBulkPayload.jobs[0].predictive_context.location_catalog_entry_id, 'catalog-mvd');
assert.equal(lastBulkPayload.jobs[0].location, 'Montevideo');
console.log('DISC-14 Playwright: bulk guarda metadata predictiva OK');

await browser.close();
