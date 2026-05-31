import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env["UI8_BASE_URL"] ?? "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.addInitScript(() => {
  window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "ui8-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
});

await page.route('https://*.tile.openstreetmap.org/**', async (route) => {
  await route.fulfill({ status: 204, body: '' });
});
await page.route('**/api/v1/alerts/unread-count**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { count: 2 } }) });
});
await page.route('**/api/v1/alerts?**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
});
await page.route('**/api/v1/stats/overview', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { total_leads: 8, total_outreach: 3 } }) });
});
await page.route('**/api/v1/stats/outreach', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ status: 'responded', count: 1 }] }) });
});
await page.route('**/api/v1/pipeline/runs**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'run-1', status: 'failed', created_at: '2026-05-27T00:00:00Z' }], next_cursor: null, total: 1 }) });
});
await page.route('**/api/v1/discovery/jobs**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'job-1', status: 'failed', source: 'google_places', location: 'Montevideo', niche: 'restaurant', created_at: '2026-05-27T00:00:00Z' }], next_cursor: null, total: 1 }) });
});
await page.route('**/api/v1/admin/niches/groups**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
});
await page.route('**/api/v1/admin/geo/zones**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ zone_id: 'montevideo', departamento: 'Montevideo', ciudad: 'Montevideo', barrio: null, label: 'Montevideo', kind: 'ciudad', lead_count: 4, last_seen_at: '2026-05-27T00:00:00Z' }], total: 1 }) });
});
await page.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { locations: [{ location_key: 'montevideo::a', location_label: 'Montevideo Centro · Cuadrícula A', parent_location_key: 'montevideo', parent_location_label: 'Montevideo', lead_count: 4, hot_leads_count: 2, avg_prospect_score: 78, commercial_density_score: 91, gps_points: [{ lat: -34.905, lng: -56.191 }], raw_gps_lead_count: 4, geocoded_lead_count: 0, grid_center: { lat: -34.905, lng: -56.191 } }], exact_points: [{ lat: -34.905, lng: -56.191 }], geocoded_points: [], meta: { raw_gps_leads: 4, geocoded_address_leads: 0, unresolved_address_leads: 0, deferred_geocode_leads: 0, filtered_leads: 4, positioned_leads: 4, grid_cell_size_km: 2.2 } } }) });
});
await page.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, has_more: false }) });
});
await page.route('**/api/v1/leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, next_cursor: null }) });
});

await page.goto(baseUrl + '/admin');
await page.waitForSelector('[data-testid="location-density-visible-count"]');
await assert.doesNotReject(async () => page.getByText('Alertas: Solo lo que cambia decisión o requiere intervención').waitFor({ state: 'detached', timeout: 1000 }));
await page.getByRole('button', { name: '2 alertas sin leer' }).waitFor();
console.log('UI-8 Playwright: bloque hardcoded ausente y campanita presente OK');

await browser.close();
