import assert from "node:assert/strict";
import { chromium } from "playwright";

type LeadFixture = {
  id: string;
  name: string;
  niche: string;
  source: string;
  prospect_score: number;
  contact_tier: string;
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

const baseUrl = process.env["MAP7_BASE_URL"] ?? "http://127.0.0.1:3000";

const leads: LeadFixture[] = [
  { id: "mvd-a", name: "Restaurante Centro", niche: "restaurant", source: "yelu", prospect_score: 82, contact_tier: "A", parent_location_key: "montevideo", parent_location_label: "Montevideo", location_key: "montevideo-centro::a", location_label: "Montevideo Centro · Cuadrícula A", lat: -34.905, lng: -56.191 },
  { id: "mvd-b", name: "Hotel Pocitos", niche: "hotel", source: "osm", prospect_score: 74, contact_tier: "B", parent_location_key: "montevideo", parent_location_label: "Montevideo", location_key: "montevideo-pocitos::b", location_label: "Montevideo Pocitos · Cuadrícula B", lat: -34.913, lng: -56.148 },
  { id: "salto-a", name: "Clinica Salto", niche: "clinic", source: "yelu", prospect_score: 77, contact_tier: "A", parent_location_key: "salto", parent_location_label: "Salto", location_key: "salto-centro::c", location_label: "Salto Centro · Cuadrícula C", lat: -31.39, lng: -57.96 },
  { id: "salto-b", name: "Hotel Salto", niche: "hotel", source: "osm", prospect_score: 62, contact_tier: "B", parent_location_key: "salto", parent_location_label: "Salto", location_key: "salto-centro::c", location_label: "Salto Centro · Cuadrícula C", lat: -31.391, lng: -57.961 },
];

const zones = [
  { zone_id: "montevideo", departamento: "Montevideo", ciudad: "Montevideo", barrio: null, label: "Montevideo", kind: "ciudad", lead_count: 2, last_seen_at: "2026-05-27T00:00:00Z" },
  { zone_id: "salto", departamento: "Salto", ciudad: "Salto", barrio: null, label: "Salto", kind: "ciudad", lead_count: 2, last_seen_at: "2026-05-27T00:00:00Z" },
] as const;

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function filterMapLeads(url: URL): LeadFixture[] {
  const zoneIds = parseList(url.searchParams.get("zone_ids"));
  const minScore = Number(url.searchParams.get("prospect_score_gte") ?? "0");
  return leads.filter((lead) => {
    if (zoneIds && !zoneIds.includes(lead.parent_location_key)) return false;
    if (lead.prospect_score < minScore) return false;
    return true;
  });
}

function buildDensityResponse(url: URL) {
  const filtered = filterMapLeads(url);
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
    current.raw_gps_lead_count += 1;
    groups.set(lead.location_key, current);
  }

  const locations = Array.from(groups.values()).map((location) => ({
    ...location,
    avg_prospect_score: Number((location.avg_prospect_score / location.lead_count).toFixed(1)),
    commercial_density_score: Math.min(100, location.lead_count * 35 + location.hot_leads_count * 15),
  }));

  return {
    data: {
      locations,
      exact_points: filtered.map((lead) => ({ lat: lead.lat, lng: lead.lng })),
      geocoded_points: [],
      meta: {
        raw_gps_leads: filtered.length,
        geocoded_address_leads: 0,
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
  const filtered = filterMapLeads(url);
  const locationKey = url.searchParams.get("location_key");
  const selected = filtered.filter((lead) => !locationKey || lead.location_key === locationKey);
  return {
    data: selected.map((lead) => ({
      id: lead.id,
      name: lead.name,
      niche: lead.niche,
      contact_tier: lead.contact_tier,
      prospect_score: lead.prospect_score,
      address: lead.location_label,
      gps: { lat: lead.lat, lng: lead.lng },
      map_point: { lat: lead.lat, lng: lead.lng },
      source: lead.source,
    })),
    total: selected.length,
    has_more: false,
  };
}

function buildListLeadsResponse(url: URL) {
  const minScore = Number(url.searchParams.get("prospect_score_gte") ?? "0");
  const parentLocationKeys = parseList(url.searchParams.get("parent_location_keys"));
  const gridLocationKeys = parseList(url.searchParams.get("grid_location_keys"));
  const filtered = leads.filter((lead) => {
    if (lead.prospect_score < minScore) return false;
    if (parentLocationKeys && !parentLocationKeys.includes(lead.parent_location_key)) return false;
    if (gridLocationKeys) {
      const gridKey = lead.location_key.split("::", 2)[1] ?? "";
      if (!gridLocationKeys.includes(gridKey)) return false;
    }
    return true;
  });

  return {
    data: filtered.map((lead) => ({
      id: lead.id,
      name: lead.name,
      niche: lead.niche,
      source: lead.source,
      canonical_source: null,
      address: lead.location_label,
      phone: null,
      whatsapp: null,
      email: null,
      website: null,
      rating: null,
      review_count: null,
      tags: [],
      state: "new",
      prospect_score: lead.prospect_score,
      contact_tier: lead.contact_tier,
      primary_offer: "sitio_web",
      pitch_hook: "Prioridad comercial visible.",
      urgency_signal: "medium",
      contacted_by: null,
      created_at: "2026-05-27T00:00:00Z",
      corroborating_sources: [],
      top_buyer_type: null,
      top_buyer_score: null,
      owner_group_id: null,
      source_confidence: null,
      data_confidence_score: null,
      contact_reliability_score: null,
      contact_ready: true,
      sources_count: 1,
    })),
    total: filtered.length,
    next_cursor: null,
  };
}

async function waitForInitialState(page: import("playwright").Page) {
  await page.waitForSelector('[data-testid="lead-review-map-pending-state"]');
  await page.getByText('Mostrando 1-4 de 4 leads').waitFor();
}

async function expectLeadSummary(page: import("playwright").Page, text: string) {
  await page.getByText(text).waitFor();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

await page.addInitScript(() => {
  window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "map7-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
});

await page.route('https://*.tile.openstreetmap.org/**', async (route) => {
  await route.fulfill({ status: 204, body: '' });
});
await page.route('**/api/v1/stats/overview', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { total_leads: 4, total_outreach: 0 } }) });
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
await page.route('**/api/v1/admin/geo/lead-density**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDensityResponse(url)) });
});
await page.route('**/api/v1/admin/geo/zone-leads**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildZoneLeadsResponse(url)) });
});
await page.route('**/api/v1/admin/geo/zones**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: zones, total: zones.length }) });
});
await page.route('**/api/v1/leads**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildListLeadsResponse(url)) });
});

await page.goto(baseUrl + '/admin');
await waitForInitialState(page);
assert.equal(await page.getByTestId('lead-review-map-pending-state').textContent(), 'Listado sincronizado');

await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Montevideo' }).click();
await page.getByText('Mostrando 1-4 de 4 leads').waitFor();
assert.equal(await page.getByTestId('lead-review-map-pending-state').textContent(), 'Cambios sin aplicar');
await page.getByTestId('lead-review-map-selection-summary').getByText('Borrador: Montevideo').waitFor();
console.log('MAP-7 Playwright: seleccionar zona no cambia lista OK');

await page.getByTestId('lead-review-map-apply').click();
await expectLeadSummary(page, 'Mostrando 1-2 de 2 leads');
assert.equal(await page.getByTestId('lead-review-map-pending-state').textContent(), 'Listado sincronizado');
await page.getByTestId('lead-review-map-selection-summary').getByText('Aplicado al listado: Montevideo').waitFor();
console.log('MAP-7 Playwright: aplicar cambia lista OK');

await page.locator('[data-testid="zone-filter-options"]').getByRole('button', { name: 'Salto' }).click();
await page.getByText('Mostrando 1-2 de 2 leads').waitFor();
assert.equal(await page.getByTestId('lead-review-map-pending-state').textContent(), 'Cambios sin aplicar');
await page.getByTestId('lead-review-map-cancel').click();
await expectLeadSummary(page, 'Mostrando 1-2 de 2 leads');
assert.equal(await page.getByTestId('lead-review-map-pending-state').textContent(), 'Listado sincronizado');
await page.getByTestId('lead-review-map-selection-summary').getByText('Aplicado al listado: Montevideo').waitFor();
console.log('MAP-7 Playwright: cancelar restaura estado anterior OK');

await page.getByTestId('lead-review-map-clear').click();
await expectLeadSummary(page, 'Mostrando 1-4 de 4 leads');
assert.equal(await page.getByTestId('lead-review-map-pending-state').textContent(), 'Listado sincronizado');
await page.getByTestId('lead-review-map-selection-summary').getByText('Sin selección aplicada al listado').waitFor();
console.log('MAP-7 Playwright: limpiar vuelve al universo inicial OK');

await browser.close();
