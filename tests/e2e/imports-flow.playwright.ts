import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env["DISC12_BASE_URL"] ?? "http://127.0.0.1:3000";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.addInitScript(() => {
  window.localStorage.setItem("blindspot-auth", JSON.stringify({ state: { token: "disc12-test-token", email: "admin@blindspot.local", role: "admin" }, version: 0 }));
});

await page.route('**/api/v1/alerts/unread-count**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { count: 0 } }) });
});
await page.route('**/api/v1/admin/imports/locations?**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'hist-1', action: 'discovery.places.import', occurred_at: '2026-05-27T12:00:00Z', actor_user_id: 'admin-user-id', actor_role: 'admin', filename: 'seed.xlsx', row_count: 4, inserted: 3, updated: 0, skipped: 1, invalid_count: 0, duplicate_count: 1, upsert: false }], total: 1 }) });
});
await page.route('**/api/v1/admin/discovery/places**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'place-1', location_key: 'montevideo-centro', display_name: 'Montevideo Centro', parent_location: 'Montevideo', kind: 'barrio', lat_approx: -34.9, lng_approx: -56.19, commercial_score: 82, notes: null, source: 'xls_import', imported_at: '2026-05-27T12:00:00Z' }], total: 1 }) });
});
await page.route('**/api/v1/admin/imports/locations/preview', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { filename: 'places.xlsx', row_count: 3, valid_count: 2, invalid_count: 1, duplicate_count: 1, entries: [{ location_key: 'montevideo-centro', display_name: 'Montevideo Centro', parent_location: 'Montevideo', kind: 'barrio', lat_approx: -34.9, lng_approx: -56.19, commercial_score: 82, notes: null }, { location_key: 'salto-centro', display_name: 'Salto Centro', parent_location: 'Salto', kind: 'barrio', lat_approx: -31.39, lng_approx: -57.96, commercial_score: 74, notes: null }], row_validation_errors: [{ row: 4, reason: 'Row 4: missing location_key' }], duplicate_entries: [{ location_key: 'montevideo-centro', display_name: 'Montevideo Centro' }] } }) });
});
await page.route('**/api/v1/admin/imports/locations/commit', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { inserted: 1, updated: 0, skipped: 1, row_validation_errors: [], upsert_errors: [], duplicate_keys: ['montevideo-centro'] } }) });
});

await page.goto(baseUrl + '/admin/imports');
await page.getByText('Historial de importaciones').waitFor();

await page.locator('input[type="file"]').setInputFiles({
  name: 'places.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from('stub'),
});

await page.getByTestId('imports-preview-ready').waitFor();
await page.getByText('Fila 4: Row 4: missing location_key').waitFor();
await page.getByTestId('imports-preview-ready').getByRole('cell', { name: 'Montevideo Centro' }).waitFor();
console.log('DISC-12 Playwright: preview visible OK');

await page.getByRole('button', { name: 'Confirmar importación' }).click();
await page.getByText('Importado: 1 nuevos, 0 actualizados, 1 omitidos.').waitFor();
console.log('DISC-12 Playwright: confirmación visible OK');

assert.equal(await page.getByText('Eventos recientes').count(), 1);
await browser.close();
