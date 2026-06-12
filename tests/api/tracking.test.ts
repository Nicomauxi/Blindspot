import { describe, it, expect, vi, beforeEach } from "vitest";

const LEAD_ID   = "aaaaaaaa-0000-0000-0000-000000000001";
const TRACKING_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const ADMIN_ID  = "aaaaaaaa-0000-0000-0000-000000000000";
const CM_ID     = "cccccccc-0000-0000-0000-000000000001";
const JWT_SECRET = "test-secret-at-least-32-chars-long-1234";

let _mockUser: Record<string, unknown> = {
  id: ADMIN_ID,
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

let _mockTrackings: Array<Record<string, unknown>> = [];
let _mockEvents: Array<Record<string, unknown>> = [];
let _mockStageDetails: Array<Record<string, unknown>> = [];
let _lastTrackingInsert: Record<string, unknown> | null = null;
let _lastEventInsert: Record<string, unknown> | null = null;
let _lastStageDetailUpsert: Record<string, unknown> | null = null;
let _auditInserts: Array<Record<string, unknown>> = [];
let _trackingConflict = false;

const mockLeadRow = {
  id: LEAD_ID,
  name: "Test Business",
  contact_tier: "A",
};

const mockTracking = {
  id: TRACKING_ID,
  case_code: "CRM-000001",
  title: "Test Business",
  lead_id: LEAD_ID,
  owner_id: ADMIN_ID,
  status: "pending",
  campaign_id: null,
  notes: null,
  started_at: "2026-05-24T00:00:00Z",
  updated_at: "2026-05-24T00:00:00Z",
};

function makeTrackingInsertChain(row: Record<string, unknown>) {
  return {
    select: () => ({
      single: async () =>
        _trackingConflict
          ? { data: null, error: { code: "23505" } }
          : { data: row, error: null },
    }),
  };
}

function makeTrackingQueryChain(rows: Array<Record<string, unknown>>) {
  let filtered = [...rows];
  const chain: Record<string, unknown> = {};
  chain["eq"] = (col: string, val: string) => {
    filtered = filtered.filter((r) => r[col] === val);
    return chain;
  };
  chain["order"] = () => chain;
  chain["limit"] = async (n: number) => ({ data: filtered.slice(0, n), error: null });
  chain["single"] = async () => {
    const found = filtered[0];
    return found ? { data: found, error: null } : { data: null, error: { code: "PGRST116" } };
  };
  chain["update"] = (payload: Record<string, unknown>) => {
    for (const r of rows) {
      if (r["id"] === filtered[0]?.["id"]) {
        Object.assign(r, payload);
      }
    }
    return { eq: () => Promise.resolve({ error: null }) };
  };
  return chain;
}

function makeEventsQueryChain(rows: Array<Record<string, unknown>>) {
  let filtered = [...rows];
  const chain: Record<string, unknown> = {};
  chain["eq"] = (col: string, val: string) => {
    filtered = filtered.filter((r) => r[col] === val);
    return chain;
  };
  chain["order"] = () => chain;
  chain["limit"] = async (n: number) => ({ data: filtered.slice(0, n), error: null });
  chain["then"] = (cb: (r: unknown) => void) => cb({ data: filtered, error: null });
  Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
  // Make it thenable for Supabase response
  (chain as unknown as Promise<unknown>).then = (cb: (r: unknown) => void) =>
    Promise.resolve(cb({ data: filtered, error: null })) as never;
  return {
    eq: (col: string, val: string) => {
      const sub = filtered.filter((r) => r[col] === val);
      return {
        order: () => ({
          // direct await resolves to { data, error }
          then: (resolve: (v: unknown) => void) => resolve({ data: sub, error: null }),
        }),
      };
    },
  };
}

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => Promise.resolve({ data: ids.map((id) => ({ id, email: id === ADMIN_ID ? "admin@blindspot.local" : "cm@blindspot.local" })), error: null }),
            eq: () => ({
              single: async () => ({ data: _mockUser, error: null }),
            }),
          }),
        };
      }
      if (table === "leads") {
        const mockLeadData = {
          id: LEAD_ID,
          name: "Test Business",
          niche: "restaurants",
          address: "Test St 123",
          website: null,
          phone: "+598 99 111 222",
          whatsapp: null,
          canonical_fields: { email: "dueno@test.uy" }, // shape legacy string (N33)
        };
        // Simula PostgREST: la tabla leads NO tiene columna email → 400 (42703). N30/N34.
        const LEAD_COLUMNS = new Set(["id", "name", "niche", "address", "website", "phone", "whatsapp", "canonical_fields"]);
        return {
          select: (columns = "*") => {
            const requested = String(columns).split(",").map((c) => c.trim()).filter(Boolean);
            const unknown = columns === "*" ? [] : requested.filter((c) => !LEAD_COLUMNS.has(c));
            const fail = unknown.length > 0;
            return {
              in: (_col: string, _ids: string[]) =>
                Promise.resolve({ data: [{ id: mockLeadData.id, name: mockLeadData.name }], error: null }),
              eq: (_col: string, _val: string) => ({
                single: async () =>
                  fail
                    ? { data: null, error: { code: "42703", message: `column leads.${unknown[0]} does not exist` } }
                    : { data: mockLeadData, error: null },
              }),
            };
          },
        };
      }
      if (table === "lead_dashboard") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              single: async () =>
                val === LEAD_ID
                  ? { data: mockLeadRow, error: null }
                  : { data: null, error: { code: "PGRST116" } },
            }),
            limit: async () => ({ data: [mockLeadRow], error: null }),
          }),
        };
      }
      if (table === "lead_tracking") {
        return {
          select: () => makeTrackingQueryChain(_mockTrackings),
          insert: (payload: unknown) => {
            _lastTrackingInsert = payload as Record<string, unknown>;
            const row = {
              ...mockTracking,
              ...(payload as Record<string, unknown>),
              id: TRACKING_ID,
            };
            if (!_trackingConflict) _mockTrackings.push(row);
            return makeTrackingInsertChain(row);
          },
          update: (payload: Record<string, unknown>) => {
            let matchedId: string | null = null;
            let matchedStatus: string | null = null;
            const chain = {
              eq: (col: string, val: string) => {
                if (col === "id") matchedId = val;
                if (col === "status") matchedStatus = val;
                return chain;
              },
              select: () => ({
                // Comportamiento real de supabase-js: .single() sobre 0 filas → error PGRST116.
                single: async () => {
                  const t = _mockTrackings.find(
                    (r) => r["id"] === matchedId &&
                           (matchedStatus === null || r["status"] === matchedStatus)
                  );
                  if (!t) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
                  Object.assign(t, payload);
                  return { data: { ...t }, error: null };
                },
                maybeSingle: async () => {
                  const t = _mockTrackings.find(
                    (r) => r["id"] === matchedId &&
                           (matchedStatus === null || r["status"] === matchedStatus)
                  );
                  if (!t) return { data: null, error: null };
                  Object.assign(t, payload);
                  return { data: { ...t }, error: null };
                },
              }),
            };
            return chain;
          },
        };
      }
      if (table === "lead_tracking_events") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              order: () => ({
                then: (resolve: (v: unknown) => void) =>
                  resolve({ data: _mockEvents.filter((e) => e[col] === val), error: null }),
              }),
            }),
          }),
          insert: (payload: unknown) => {
            _lastEventInsert = payload as Record<string, unknown>;
            const row = { id: `evt-${_mockEvents.length + 1}`, ...(payload as Record<string, unknown>) };
            _mockEvents.push(row);
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
              // also support direct await (for transition endpoint which doesn't chain select)
              then: (resolve: (v: unknown) => void) => resolve({ error: null }),
            };
          },
        };
      }
      if (table === "lead_tracking_stage_details") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              order: async () => ({ data: _mockStageDetails.filter((detail) => detail["tracking_id"] === val), error: null }),
            }),
          }),
          upsert: (payload: Record<string, unknown>) => {
            _lastStageDetailUpsert = payload;
            const existing = _mockStageDetails.find((detail) => detail["tracking_id"] === payload["tracking_id"] && detail["stage"] === payload["stage"]);
            const row = {
              id: existing?.["id"] ?? "stage-1",
              created_at: existing?.["created_at"] ?? "2026-05-24T00:00:00Z",
              updated_at: "2026-05-25T00:00:00Z",
              ...existing,
              ...payload,
            };
            if (existing) {
              Object.assign(existing, row);
            } else {
              _mockStageDetails.push(row);
            }
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          },
        };
      }
      if (table === "audit_log") {
        return {
          insert: (payload: unknown) => {
            _auditInserts.push(payload as Record<string, unknown>);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
  }),
}));

beforeEach(() => {
  process.env["API_JWT_SECRET"] = JWT_SECRET;
  _mockUser = { id: ADMIN_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  _mockTrackings = [];
  _mockEvents = [];
  _mockStageDetails = [];
  _lastTrackingInsert = null;
  _lastEventInsert = null;
  _lastStageDetailUpsert = null;
  _auditInserts = [];
  _trackingConflict = false;
});

describe("POST /api/v1/tracking", () => {
  it("creates a tracking entry for an accessible lead", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ lead_id: LEAD_ID, notes: "Primer contacto" }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ lead_id: LEAD_ID, status: "pending", owner_id: ADMIN_ID });
    expect(_lastTrackingInsert).toMatchObject({ lead_id: LEAD_ID, owner_id: ADMIN_ID, status: "pending", title: "Test Business" });
    expect(_lastEventInsert).toMatchObject({ event_type: "system_status_change", from_status: null, to_status: "pending" });
    expect(_auditInserts[0]).toMatchObject({ action: "tracking.create", target_type: "lead", target_id: LEAD_ID });
    await app.close();
  });

  it("returns 404 for unknown lead", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ lead_id: "dddddddd-0000-0000-0000-000000000099" }),
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 409 when active tracking already exists", async () => {
    _trackingConflict = true;
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ lead_id: LEAD_ID }),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("tracking_conflict");
    await app.close();
  });

  it("returns 401 without token", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_id: LEAD_ID }),
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /api/v1/tracking", () => {
  beforeEach(() => {
    _mockTrackings = [
      { ...mockTracking, id: TRACKING_ID, owner_id: ADMIN_ID },
      { ...mockTracking, id: "bbbbbbbb-0000-0000-0000-000000000002", owner_id: CM_ID, status: "contact" },
    ];
  });

  it("admin sees all trackings", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tracking",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    await app.close();
  });

  it("CM sees only own trackings", async () => {
    _mockUser = { id: CM_ID, email: "cm@blindspot.local", role: "cm", lead_filter: null, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: CM_ID, email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tracking",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.every((t: { owner_id: string }) => t.owner_id === CM_ID)).toBe(true);
    await app.close();
  });

  it("admin can filter by owner_id", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking?owner_id=${CM_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.every((t: { owner_id: string }) => t.owner_id === CM_ID)).toBe(true);
    await app.close();
  });
});

describe("GET /api/v1/tracking/:id", () => {
  beforeEach(() => {
    _mockTrackings = [{ ...mockTracking }];
    _mockEvents = [
      { id: "evt-1", tracking_id: TRACKING_ID, event_type: "system_status_change", from_status: null, to_status: "pending", actor_user_id: ADMIN_ID, actor_role: "admin", notes: null, created_at: "2026-05-24T00:00:00Z" },
    ];
  });

  it("returns tracking with events", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/${TRACKING_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: TRACKING_ID, status: "pending" });
    expect(res.json().data.events).toBeInstanceOf(Array);
    expect(res.json().data.events[0]).toMatchObject({ actor_email: "admin@blindspot.local" });
    expect(res.json().data.stage_details).toEqual([]);
    await app.close();
  });

  it("N2.3: el lead embebido trae contacto (no null por columna inexistente)", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/${TRACKING_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const lead = res.json().data.lead;
    expect(lead).not.toBeNull();
    expect(lead.name).toBe("Test Business");
    expect(lead.phone).toBe("+598 99 111 222");
    // email derivado de canonical_fields (string legacy o {value}).
    expect(lead.email).toBe("dueno@test.uy");
    expect(res.json().data.lead_name).toBe("Test Business");
    await app.close();
  });

  it("CM cannot see tracking owned by another user", async () => {
    _mockUser = { id: CM_ID, email: "cm@blindspot.local", role: "cm", lead_filter: null, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: CM_ID, email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracking/${TRACKING_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /api/v1/tracking/:id/transition", () => {
  beforeEach(() => {
    _mockTrackings = [{ ...mockTracking, status: "pending" }];
  });

  it("transitions from pending to validation", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/transition`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to_status: "validation", notes: "Validando datos" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("validation");
    expect(_lastEventInsert).toMatchObject({ event_type: "system_status_change", from_status: "pending", to_status: "validation" });
    expect(_auditInserts[0]).toMatchObject({ action: "tracking.transition", target_type: "lead" });
    await app.close();
  });

  it("N2.2: una transición concurrente devuelve 409 state_conflict (no 500)", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    // Simula la carrera: otro proceso ya movió el tracking después del read inicial.
    // El mock filtra el UPDATE por status=currentStatus; cambiamos el row al vuelo
    // interceptando el primer fetch (status leído = pending) y mutando luego.
    const original = _mockTrackings[0]!;
    const originalStatusGetter = original["status"];
    let reads = 0;
    Object.defineProperty(original, "status", {
      configurable: true,
      get() {
        reads += 1;
        // Primer read (handler lee currentStatus) → pending; después → ya cambiado.
        return reads <= 1 ? originalStatusGetter : "observed";
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/transition`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to_status: "validation", notes: "x" }),
    });

    Object.defineProperty(original, "status", { configurable: true, value: "pending", writable: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("state_conflict");
    await app.close();
  });

  it("rejects invalid transition with 422", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/transition`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to_status: "accepted" }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error_code).toBe("invalid_transition");
    await app.close();
  });

  it("records channel when transitioning to contact", async () => {
    _mockTrackings = [{ ...mockTracking, status: "validation" }];
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/transition`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to_status: "contact", channel: "whatsapp" }),
    });

    expect(res.statusCode).toBe(200);
    expect(_lastEventInsert).toMatchObject({ channel: "whatsapp", to_status: "contact" });
    await app.close();
  });

  it("requires a reason for backward transitions", async () => {
    _mockTrackings = [{ ...mockTracking, status: "contact" }];
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/transition`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ to_status: "validation" }),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error_code).toBe("tracking_reason_required");
    await app.close();
  });
});

describe("POST /api/v1/tracking/:id/note", () => {
  beforeEach(() => {
    _mockTrackings = [{ ...mockTracking, status: "contact" }];
  });

  it("adds a standalone note to the tracking timeline", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/note`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: "Llamé pero no atendió." }),
    });

    expect(res.statusCode).toBe(201);
    expect(_lastEventInsert).toMatchObject({
      event_type:  "manual_comment",
      from_status: "contact",
      to_status:   "contact",
      notes:       "Llamé pero no atendió.",
    });
    await app.close();
  });

  it("returns 400 for empty notes", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/note`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: "   " }),
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when CM tries to note tracking owned by another user", async () => {
    _mockUser = { id: CM_ID, email: "cm@blindspot.local", role: "cm", lead_filter: null, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: CM_ID, email: "cm@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/note`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: "Intento de nota" }),
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("allows manual notes on terminal trackings", async () => {
    _mockTrackings = [{ ...mockTracking, status: "accepted" }];
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/tracking/${TRACKING_ID}/note`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: "Cierre confirmado por el cliente." }),
    });

    expect(res.statusCode).toBe(201);
    expect(_lastEventInsert).toMatchObject({ event_type: "manual_comment", to_status: "accepted" });
    await app.close();
  });
});

describe("PATCH /api/v1/tracking/:id", () => {
  beforeEach(() => {
    _mockTrackings = [{ ...mockTracking }];
  });

  it("updates the editable tracking title", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/tracking/${TRACKING_ID}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Caso Montevideo Centro" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Caso Montevideo Centro");
    expect(_auditInserts[0]).toMatchObject({ action: "tracking.update" });
    await app.close();
  });
});

describe("PUT /api/v1/tracking/:id/stage-details", () => {
  beforeEach(() => {
    _mockTrackings = [{ ...mockTracking, status: "contact" }];
  });

  it("upserts stage details for the current stage by default", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: ADMIN_ID, email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/tracking/${TRACKING_ID}/stage-details`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: "Contacto inicial hecho", data: { channel: "whatsapp", attempts: 1 } }),
    });

    expect(res.statusCode).toBe(200);
    expect(_lastStageDetailUpsert).toMatchObject({ stage: "contact", summary: "Contacto inicial hecho" });
    expect(res.json().data.data).toEqual({ channel: "whatsapp", attempts: 1 });
    await app.close();
  });
});
