import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env["MAP8_BASE_URL"] ?? "http://127.0.0.1:3000";

const densityResponse = {
  data: {
    locations: [
      {
        location_key: "montevideo-centro::a",
        location_label: "Montevideo Centro · Cuadrícula A",
        parent_location_key: "montevideo",
        parent_location_label: "Montevideo",
        lead_count: 2,
        hot_leads_count: 1,
        avg_prospect_score: 78,
        commercial_density_score: 90,
        gps_points: [{ lat: -34.905, lng: -56.191 }],
        raw_gps_lead_count: 2,
        geocoded_lead_count: 0,
        grid_center: { lat: -34.905, lng: -56.191 },
      },
    ],
    exact_points: [{ lat: -34.905, lng: -56.191 }],
    geocoded_points: [],
    meta: {
      raw_gps_leads: 2,
      geocoded_address_leads: 0,
      unresolved_address_leads: 0,
      deferred_geocode_leads: 0,
      filtered_leads: 2,
      positioned_leads: 2,
      grid_cell_size_km: 2.2,
    },
  },
};

const zoneLeadsResponse = {
  data: [
    {
      id: "lead-restaurante",
      name: "restaurante centro",
      niche: "restaurante",
      contact_tier: "A",
      prospect_score: 82,
      address: "18 de Julio 123, Montevideo",
      gps: { lat: -34.905, lng: -56.191 },
      map_point: { lat: -34.905, lng: -56.191 },
      source: "yelu",
      website: "https://restaurante.example.com",
      phone: "+59899111222",
      whatsapp: "+59899111222",
      email: "hola@restaurante.example.com",
      rating: 4.6,
      review_count: 87,
      primary_offer: "software_pos",
      pitch_hook: "POS con tracción clara y contacto listo.",
      contact_ready: true,
      tags: ["instagram-confirmed"],
    },
  ],
  total: 1,
  has_more: false,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

await page.addInitScript(() => {
  window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "map8-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
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
await page.route('**/api/v1/admin/niches/groups', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [{ id: 'niche-1', canonical: 'restaurant', aliases: ['restaurante'], created_at: '2026-05-27T00:00:00Z', updated_at: '2026-05-27T00:00:00Z' }] }),
  });
});
await page.route('**/api/v1/admin/geo/zones**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [{ zone_id: 'montevideo', departamento: 'Montevideo', ciudad: 'Montevideo', barrio: null, label: 'Montevideo', kind: 'ciudad', lead_count: 2, last_seen_at: '2026-05-27T00:00:00Z' }], total: 1 }),
  });
});
await page.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(densityResponse) });
});
await page.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(zoneLeadsResponse) });
});
await page.route('**/api/v1/leads**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, next_cursor: null }) });
});

async function openLeadCard() {
  await page.goto(baseUrl + '/admin');
  await page.waitForSelector('[data-testid="location-density-list-item"]');
  await assert.doesNotReject(async () => page.getByText('Vista completa').waitFor({ state: 'detached', timeout: 1000 }));
  await assert.doesNotReject(async () => page.getByText('Ver todos').waitFor({ state: 'detached', timeout: 1000 }));
  await page.getByRole('button', { name: 'Leads individuales' }).click();
  await page.getByTestId('location-density-list-item').first().click();
  await page.getByTestId('zone-lead-card').first().waitFor();
}

await openLeadCard();
const initialIconKey = await page.getByTestId('zone-lead-icon-preview').first().getAttribute('data-icon-key');
assert.equal(initialIconKey, 'food');
await page.locator('[data-testid="zone-lead-icon-option"][data-icon-key="beauty"]').click();
await page.waitForTimeout(200);
const updatedIconKey = await page.getByTestId('zone-lead-icon-preview').first().getAttribute('data-icon-key');
assert.equal(updatedIconKey, 'beauty');
console.log('MAP-8 Playwright: cambio de icono aplicado OK');

await page.reload();
await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: 'Leads individuales' }).click();
await page.getByTestId('location-density-list-item').first().click();
await page.getByTestId('zone-lead-card').first().waitFor();
const persistedIconKey = await page.getByTestId('zone-lead-icon-preview').first().getAttribute('data-icon-key');
assert.equal(persistedIconKey, 'beauty');
console.log('MAP-8 Playwright: persistencia de icono tras recarga OK');

await browser.close();
