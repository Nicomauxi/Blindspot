import { describe, it, expect, vi, beforeEach } from "vitest";

const startFilterEnrichmentJob = vi.fn();
const countLeadsByFilterSelection = vi.fn();
const geocodeAddress = vi.fn();
const listDiscoveryPlaces = vi.fn();
const upsertDiscoveryPlaces = vi.fn();
const getGooglePlacesBudgetStatus = vi.fn();
const bulkInsertDiscoveryJobsMock = vi.fn();

vi.mock("../../src/cli/commands/enrich.js", () => ({
  startFilterEnrichmentJob,
}));

vi.mock("../../src/storage/leads.js", () => ({
  countLeadsByFilterSelection,
}));

vi.mock("../../api/src/services/lead-geocoding.js", () => ({
  createLeadGeocodingService: () => ({ geocodeAddress }),
}));

vi.mock("../../src/storage/pipeline-config.js", () => ({
  getGooglePlacesBudgetStatus,
}));

vi.mock("../../src/storage/discovery-jobs.js", () => ({
  bulkInsertDiscoveryJobs: bulkInsertDiscoveryJobsMock,
}));

vi.mock("../../src/storage/discovery-places.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage/discovery-places.js")>("../../src/storage/discovery-places.js");
  return {
    ...actual,
    listDiscoveryPlaces,
    upsertDiscoveryPlaces,
  };
});

let _activePipelineRun: Record<string, unknown> | null = null;
let _mockLeadSchemaMissingContactTier = false;
let _mockAuditLogRows: Record<string, unknown>[] = [];
let _mockDiscoveryPlaceKeys: string[] = [];
let _lastInsertedDiscoveryBatch: Record<string, unknown> | null = null;
let _lastInsertedDiscoveryJobs: Record<string, unknown>[] = [];
let _mockDiscoveryJobs: Record<string, unknown>[] = [
  {
    id: "legacy-job-id",
    batch_id: null,
    source: "yelu",
    location: "Montevideo",
    niche: "restaurant",
    status: "queued",
    enrich_after_discovery: false,
    enrich_status: "skipped",
    leads_found: 20,
    leads_new: 6,
    estimated_cost_usd: 1.8,
    completed_at: "2026-05-20T10:00:00Z",
    created_at: "2026-05-20T10:00:00Z",
  },
];

let _mockLeads: Record<string, unknown>[] = [
  {
    id: "lead-1",
    source: "yelu",
    niche: "restaurant",
    address: "Montevideo, Uruguay",
    prospect_score: 70,
    gps: { lat: -34.9, lng: -56.2 },
    corroborating_sources: [{ source: "osm" }],
  },
];

let _mockUser: Record<string, unknown> = {
  id: "admin-user-id",
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              single: async () => ({ data: _mockUser, error: null }),
              lt: () => ({ order: () => ({ limit: (_n: number) => Promise.resolve({ data: [_mockUser], error: null, count: 1 }) }) }),
            }),
            order: () => ({ limit: (_n: number) => Promise.resolve({ data: [_mockUser], error: null, count: 1 }) }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-user-id", email: "new@x.com", role: "cm", active: true, created_at: "2026-01-01T00:00:00Z" },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...(_mockUser as object), updated_at: "2026-01-01T00:00:00Z" }, error: null }),
              }),
            }),
          }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "pipeline_config") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "singleton",
                  enabled: false,
                  cron_expression: "0 2 * * 0",
                  scheduled_for: null,
                  last_completed_at: null,
                  google_places_budget_total: 200,
                  google_places_budget_spent: 40,
                  google_places_alert_threshold: 10,
                  fetch_timeout_ms: 5000,
                  fetch_retries: 1,
                  enrich_heuristic_max_concurrency: 6,
                },
                error: null,
              }),
            }),
            limit: () => ({
              single: async () => ({
                data: {
                  id: "singleton",
                  enabled: false,
                  cron_expression: "0 2 * * 0",
                  scheduled_for: null,
                  last_completed_at: null,
                  google_places_budget_total: 200,
                  google_places_budget_spent: 40,
                  google_places_alert_threshold: 10,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "singleton", enabled: true },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "pipeline_runs") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) =>
                Promise.resolve({ data: [], error: null, count: 0 }),
              maybeSingle: async () => ({ data: null }),
            }),
            eq: (_c: string, _v: unknown) => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
              limit: (_n: number) => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
            in: (_c: string, values: unknown[]) => {
              // N45: el abort ahora encadena .order().order().limit().maybeSingle()
              const chain: Record<string, unknown> = {
                limit: (_n: number) => ({
                  maybeSingle: async () => ({
                    data: _activePipelineRun && values.includes(_activePipelineRun["status"]) ? _activePipelineRun : null,
                  }),
                  then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
                }),
              };
              chain["order"] = () => chain;
              return chain;
            },
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-run-id", status: "pending" },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "lead_dashboard") {
        return {
          select: (_cols?: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: _mockLeads.map((lead) => ({ ...lead, contact_tier: (lead.contact_tier ?? null) })),
                error: null,
                count: _mockLeads.length,
              }),
              // N55: las rutas paginan con range()
              range: (from: number, to: number) => Promise.resolve({
                data: _mockLeads.slice(from, to + 1).map((lead) => ({ ...lead, contact_tier: (lead.contact_tier ?? null) })),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "discovery_jobs") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: _mockDiscoveryJobs,
                error: null,
                count: _mockDiscoveryJobs.length,
              }),
              range: (from: number, to: number) => Promise.resolve({
                data: _mockDiscoveryJobs.slice(from, to + 1),
                error: null,
              }),
            }),
            eq: () => ({
              single: async () => ({ data: { id: "job-id", status: "queued", batch_id: null }, error: null }),
              in: async () => ({ error: null }),
            }),
            in: () => ({
              order: () => Promise.resolve({
                data: [
                  {
                    id: "child-job-id",
                    batch_id: "batch-1",
                    source: "yelu",
                    location: "Montevideo",
                    niche: "restaurant",
                    status: "queued",
                    enrich_after_discovery: true,
                    enrich_status: "queued",
                    created_at: "2026-05-20T10:00:00Z",
                  },
                ],
                error: null,
              }),
            }),
            limit: (_n: number) => Promise.resolve({
              data: _mockDiscoveryJobs,
              error: null,
            }),
          }),
          insert: (payload: unknown) => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-job-id", status: "queued", batch_id: null },
                error: null,
              }),
              then: (cb: (value: unknown) => void) => {
                _lastInsertedDiscoveryJobs = Array.isArray(payload) ? payload as Record<string, unknown>[] : [];
                return cb({
                  data: Array.isArray(payload)
                    ? payload.map((entry, index) => ({ id: `child-job-${index + 1}`, ...(entry as object) }))
                    : [],
                  error: null,
                });
              },
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "job-id", status: "paused", batch_id: null },
                  error: null,
                }),
              }),
              in: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "discovery_job_batches") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: [
                  {
                    id: "batch-1",
                    location: "Montevideo",
                    location_key: "montevideo",
                    niche: "restaurant",
                    sources: ["yelu", "osm"],
                    estimated_cost_usd: 0,
                    actual_cost_usd: 0,
                    enrich_after_discovery: true,
                    status: "queued",
                    created_at: "2026-05-20T10:00:00Z",
                  },
                ],
                error: null,
                count: 1,
              }),
            }),
            eq: () => ({
              single: async () => ({ data: { id: "batch-1" }, error: null }),
            }),
          }),
          insert: (payload: unknown) => ({
            select: () => ({
              single: async () => {
                _lastInsertedDiscoveryBatch = payload as Record<string, unknown>;
                return {
                  data: { id: "batch-1", status: "queued", created_at: "2026-05-20T10:00:00Z", ...(payload as object) },
                  error: null,
                };
              },
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: (cols?: string) => ({
            order: () => ({
              limit: (_n: number) => {
                if (_mockLeadSchemaMissingContactTier && cols?.includes("contact_tier")) {
                  return Promise.resolve({
                    data: null,
                    error: { code: "42703", message: "column leads.contact_tier does not exist" },
                  });
                }
                return Promise.resolve({
                  data: _mockLeads,
                  error: null,
                });
              },
            }),
            in: (_column: string, values: string[]) => Promise.resolve({
              data: _mockLeads
                .filter((lead) => values.includes(String(lead.id)))
                .map((lead) => ({ id: lead.id, gps: lead.gps ?? null })),
              error: null,
            }),
          }),
        };
      }
      if (table === "runs") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: (_n: number) => Promise.resolve({
                  data: [{ finished_at: "2026-05-20T10:00:00Z", stats: { estimated_cost_usd: 2.5 } }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "outreach_campaigns") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
            eq: (_col: string, _val: string) => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "not used in this test" } }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ single: async () => ({ data: null, error: null }) }),
              then: (cb: (r: unknown) => void) => cb({ error: null }),
            }),
          }),
        };
      }
      if (table === "audit_log") {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) =>
                Promise.resolve({ data: _mockAuditLogRows, error: null, count: _mockAuditLogRows.length }),
            }),
            eq: () => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        };
      }
      if (table === "discovery_places_catalog") {
        return {
          select: (_cols: string) => ({
            in: (_c: string, keys: string[]) => Promise.resolve({ data: keys.filter((key) => _mockDiscoveryPlaceKeys.includes(key)).map((location_key) => ({ location_key })), error: null }),
          }),
        };
      }
      return {};
    },
    rpc: () => Promise.resolve({ error: null }),
  }),
}));

describe("Pipeline routes — admin only", () => {
  beforeEach(() => {
    startFilterEnrichmentJob.mockReset();
    startFilterEnrichmentJob.mockResolvedValue({ runId: "filter-run-1" });
    countLeadsByFilterSelection.mockReset();
    countLeadsByFilterSelection.mockResolvedValue(2);
    geocodeAddress.mockReset();
    geocodeAddress.mockResolvedValue(null);
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _activePipelineRun = null;
    _mockLeadSchemaMissingContactTier = false;
    upsertDiscoveryPlaces.mockReset();
    getGooglePlacesBudgetStatus.mockReset();
    bulkInsertDiscoveryJobsMock.mockReset();
    bulkInsertDiscoveryJobsMock.mockImplementation(async (jobs) => {
      _lastInsertedDiscoveryJobs = Array.isArray(jobs) ? jobs as Record<string, unknown>[] : [];
      return _lastInsertedDiscoveryJobs.map((entry, index) => ({ id: `bulk-job-${index + 1}`, ...(entry as object) }));
    });
    getGooglePlacesBudgetStatus.mockResolvedValue({ budget_total: 200, budget_spent: 40, budget_remaining: 160, alert_threshold: 10, over_alert: false });
    upsertDiscoveryPlaces.mockResolvedValue({ inserted: 0, updated: 0, skipped: 0, errors: [] });
    _mockAuditLogRows = [];
    _mockDiscoveryPlaceKeys = [];
    _lastInsertedDiscoveryBatch = null;
    _lastInsertedDiscoveryJobs = [];
    _mockDiscoveryJobs = [
      {
        id: "legacy-job-id",
        batch_id: null,
        source: "yelu",
        location: "Montevideo",
        niche: "restaurant",
        status: "queued",
        enrich_after_discovery: false,
        enrich_status: "skipped",
        leads_found: 20,
        leads_new: 6,
        estimated_cost_usd: 1.8,
        completed_at: "2026-05-20T10:00:00Z",
        created_at: "2026-05-20T10:00:00Z",
      },
    ];
    _mockLeads = [
      {
        id: "lead-1",
        source: "yelu",
        niche: "restaurant",
        address: "Montevideo, Uruguay",
        prospect_score: 70,
        gps: { lat: -34.9, lng: -56.2 },
        corroborating_sources: [{ source: "osm" }],
      },
    ];
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("GET /pipeline/config returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/config",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /pipeline/config returns 200 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/config",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("POST /pipeline/run returns 202 with run_id", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data).toHaveProperty("run_id");
    await app.close();
  });

  it("POST /pipeline/run blocks when a pending run already exists", async () => {
    _activePipelineRun = { id: "pending-run-id", status: "pending" };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("run_already_active");
    await app.close();
  });

  it("POST /pipeline/abort aborts a pending run too", async () => {
    _activePipelineRun = { id: "pending-run-id", status: "pending" };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/abort",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ run_id: "pending-run-id", abort_requested: true });
    await app.close();
  });

  it("POST /pipeline/run accepts dry_run and still queues a run", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pipeline/run",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ dry_run: true }),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.run_id).toBeDefined();
    expect(body.data.dry_run).toBe(true);
    await app.close();
  });

  it("GET /pipeline/runs returns 200 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/runs",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("Discovery routes", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    geocodeAddress.mockReset();
    geocodeAddress.mockResolvedValue(null);
    _mockLeads = [
      {
        id: "lead-1",
        source: "yelu",
        niche: "restaurant",
        address: "Montevideo, Uruguay",
        prospect_score: 70,
        gps: { lat: -34.9, lng: -56.2 },
        corroborating_sources: [{ source: "osm" }],
      },
    ];
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("POST /discovery/jobs returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "yelu", location: "Montevideo" }),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /discovery/jobs returns 201 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "yelu", location: "Montevideo", niche: "restaurant" }),
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("POST /discovery/job-batches defaults enrich_after_discovery to true", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/job-batches",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sources: ["yelu", "osm"], location: "Montevideo", niche: "restaurant" }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.enrich_after_discovery).toBe(true);
    expect(body.data.jobs.every((job: { enrich_after_discovery?: boolean; enrich_status?: string }) => job.enrich_after_discovery === true && job.enrich_status === "queued")).toBe(true);
    await app.close();
  });

  it("POST /discovery/job-batches acepta la fuente miem_dei (DEI)", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/job-batches",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sources: ["miem_dei"], location: "Florida", niche: "", enrich_after_discovery: false }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.jobs[0]?.source).toBe("miem_dei");
    await app.close();
  });

  it("POST /discovery/job-batches supports discovery-only mode", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/job-batches",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sources: ["yelu"], location: "Montevideo", niche: "restaurant", enrich_after_discovery: false }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.enrich_after_discovery).toBe(false);
    expect(body.data.jobs[0]?.enrich_status).toBe("skipped");
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs returns 202 with run id when collection is valid", async () => {
    startFilterEnrichmentJob.mockResolvedValue({ runId: "filter-run-1" });
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", prospect_score_gte: 70, with_heuristic: true, concurrency: 4 }),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.run_id).toBe("filter-run-1");
    expect(body.data.lead_count).toBe(2);
    expect(startFilterEnrichmentJob).toHaveBeenCalledWith({
      filters: { source: "google_places", prospect_score_gte: 70, contact_tier: undefined, niche: undefined, primary_offer: undefined, q: undefined },
      withHeuristic: true,
      concurrency: 4,
      forceRefresh: false,
      heuristicConcurrency: 4,
      leadLimit: 250,
      rescoreOnComplete: false,
    });
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs rejects requests without relevant filters", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ with_heuristic: true, concurrency: 4 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("filters_required");
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs pasa force_refresh y heuristicConcurrency al job", async () => {
    startFilterEnrichmentJob.mockResolvedValue({ runId: "filter-run-2" });
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4, force_refresh: true }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.force_refresh).toBe(true);
    expect(startFilterEnrichmentJob).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true, heuristicConcurrency: 4, leadLimit: 250 })
    );
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs pasa rescore_on_complete al job", async () => {
    startFilterEnrichmentJob.mockResolvedValue({ runId: "filter-run-4" });
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4, rescore_on_complete: true }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.rescore_on_complete).toBe(true);
    expect(startFilterEnrichmentJob).toHaveBeenCalledWith(
      expect.objectContaining({ rescoreOnComplete: true })
    );
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs scope=all acepta colecciones grandes (hasta 10000)", async () => {
    countLeadsByFilterSelection.mockResolvedValue(1234);
    startFilterEnrichmentJob.mockResolvedValue({ runId: "filter-run-3" });
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4, scope: "all" }),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.lead_count).toBe(1234);
    expect(body.data.scope).toBe("all");
    expect(startFilterEnrichmentJob).toHaveBeenCalledWith(
      expect.objectContaining({ leadLimit: 10000 })
    );
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs scope selección (default) mantiene el tope de 250", async () => {
    countLeadsByFilterSelection.mockResolvedValue(1234);
    startFilterEnrichmentJob.mockClear();
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4 }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_limit_exceeded");
    expect(body.details).toEqual({ lead_count: 1234, limit: 250 });
    expect(startFilterEnrichmentJob).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs scope=all rechaza más de 10000 leads", async () => {
    countLeadsByFilterSelection.mockResolvedValue(10001);
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4, scope: "all" }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_limit_exceeded");
    expect(body.details).toEqual({ lead_count: 10001, limit: 10000 });
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs settea los knobs de velocidad del config en el env del proceso", async () => {
    delete process.env["FETCH_TIMEOUT_MS"];
    delete process.env["FETCH_RETRIES"];
    delete process.env["ENRICH_HEURISTIC_MAX_CONCURRENCY"];
    countLeadsByFilterSelection.mockResolvedValue(2);
    startFilterEnrichmentJob.mockResolvedValue({ runId: "filter-run-5" });
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4 }),
    });
    expect(res.statusCode).toBe(202);
    // El mock de pipeline_config define 5000/1/6: el job in-process los lee del env por llamada.
    expect(process.env["FETCH_TIMEOUT_MS"]).toBe("5000");
    expect(process.env["FETCH_RETRIES"]).toBe("1");
    expect(process.env["ENRICH_HEURISTIC_MAX_CONCURRENCY"]).toBe("6");
    delete process.env["FETCH_TIMEOUT_MS"];
    delete process.env["FETCH_RETRIES"];
    delete process.env["ENRICH_HEURISTIC_MAX_CONCURRENCY"];
    await app.close();
  });

  it("POST /admin/enrichment/filter-jobs scope=all no aplica a re_discovery", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/enrichment/filter-jobs",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "google_places", with_heuristic: true, concurrency: 4, scope: "all", mode: "re_discovery" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("scope_not_supported");
    await app.close();
  });

  it("GET /discovery/suggestions returns real recommendation payload", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/suggestions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.coverage_gaps_global)).toBe(true);
    expect(Array.isArray(body.data.location_density)).toBe(true);
    await app.close();
  });

  it("GET /discovery/coverage returns grouped coverage data", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/coverage",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.coverage_gaps_global)).toBe(true);
    expect(Array.isArray(body.data.supported_sources)).toBe(true);
    await app.close();
  });

  it("GET /admin/geo/lead-density rejects unsupported filters", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?source=linkedin&contact_tier=Z&gps_source=maybe",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("invalid_query");
    await app.close();
  });

  it("GET /admin/geo/lead-density returns granular zones and metadata", async () => {
    geocodeAddress.mockImplementation(async (address: string) => address.includes("Pocitos") ? { lat: -34.916, lng: -56.149 } : null);
    _mockLeads = [
      {
        id: "lead-gps",
        source: "yelu",
        niche: "restaurant",
        address: "Pocitos, Montevideo, Uruguay",
        prospect_score: 81,
        contact_tier: "A",
        gps: { lat: -34.905, lng: -56.191 },
        corroborating_sources: [],
      },
      {
        id: "lead-google",
        source: "google_places",
        niche: "restaurant",
        address: "Pocitos, Montevideo, Uruguay",
        prospect_score: 77,
        contact_tier: "B",
        gps: { lat: -34.904, lng: -56.19 },
        corroborating_sources: [],
      },
      {
        id: "lead-address",
        source: "osm",
        niche: "restaurant",
        address: "Benito Blanco 1234, Pocitos, Montevideo",
        prospect_score: 64,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?limit=10&source=google_places,osm&niche=restaurant&prospect_score_gte=70&contact_tier=B&gps_source=google",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.locations)).toBe(true);
    expect(body.data.meta.filtered_leads).toBe(1);
    expect(body.data.meta.positioned_leads).toBe(1);
    expect(body.data.meta.raw_gps_leads).toBe(1);
    expect(body.data.meta.geocoded_address_leads).toBe(0);
    expect(body.data.locations[0]).toHaveProperty("parent_location_label");
    expect(geocodeAddress).not.toHaveBeenCalled();
    await app.close();
  });

  it("GET /admin/geo/lead-density clampea bbox fuera de rango (zoom-out extremo) en vez de 400", async () => {
    _mockLeads = [
      {
        id: "lead-gps",
        source: "yelu",
        niche: "restaurant",
        address: "Pocitos, Montevideo, Uruguay",
        prospect_score: 81,
        contact_tier: "A",
        gps: { lat: -34.905, lng: -56.191 },
        corroborating_sources: [],
      },
    ];
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    // Viewport que da la vuelta al mundo: west=-638, east=454, north=89.4 (válido), south=-85.
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?prospect_score_gte=0&limit=4000&heat_metric=mixed&zoom=0&south=-85.051129&west=-638.4375&north=89.400096&east=454.21875",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.locations)).toBe(true);
    await app.close();
  });

  it("GET /admin/geo/lead-density does not 500 when geocoding one lead fails", async () => {
    geocodeAddress.mockImplementation(async (address: string) => {
      if (address.includes("Falla")) throw new Error("geocoder unavailable");
      return null;
    });
    _mockLeads = [
      {
        id: "lead-gps-ok",
        source: "yelu",
        niche: "restaurant",
        address: "Montevideo, Uruguay",
        prospect_score: 72,
        contact_tier: "A",
        gps: { lat: -34.9, lng: -56.2 },
        corroborating_sources: [],
      },
      {
        id: "lead-geocode-fails",
        source: "osm",
        niche: "restaurant",
        address: "Calle Falla 123, Montevideo",
        prospect_score: 65,
        contact_tier: "B",
        gps: null,
        corroborating_sources: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?prospect_score_gte=0&limit=30&include_geocode=true",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.meta.filtered_leads).toBe(2);
    expect(body.data.meta.positioned_leads).toBe(1);
    expect(body.data.meta.unresolved_address_leads).toBe(1);
    expect(body.data.locations.length).toBeGreaterThan(0);
    await app.close();
  });

  it("GET /admin/geo/lead-density applies zone_ids with the same AND semantics as the rest of the filters", async () => {
    _mockLeads = [
      { id: "zone-mvd-match", source: "yelu", niche: "restaurant", address: "Montevideo, Uruguay", prospect_score: 82, contact_tier: "A", gps: { lat: -34.9, lng: -56.2 }, corroborating_sources: [] },
      { id: "zone-mvd-low-score", source: "yelu", niche: "restaurant", address: "Montevideo, Uruguay", prospect_score: 40, contact_tier: "A", gps: { lat: -34.91, lng: -56.19 }, corroborating_sources: [] },
      { id: "zone-salto-match", source: "yelu", niche: "restaurant", address: "Salto, Uruguay", prospect_score: 85, contact_tier: "A", gps: { lat: -31.39, lng: -57.96 }, corroborating_sources: [] },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?zone_ids=montevideo&source=yelu&niche=restaurant&prospect_score_gte=70&contact_tier=A",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.meta.filtered_leads).toBe(1);
    expect(body.data.locations).toHaveLength(1);
    expect(body.data.locations[0]?.parent_location_key).toBe("montevideo");
    await app.close();
  });

  function buildBinaryUpload(buffer: Buffer, filename: string) {
    const boundary = "----blindspot-test-boundary";
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([header, buffer, footer]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  async function buildWorkbookUpload(rows: Record<string, unknown>[]) {
    // N70: exceljs (xlsx@0.18 removido por CVEs)
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("places");
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    sheet.addRow(headers);
    for (const row of rows) {
      sheet.addRow(headers.map((h) => row[h] ?? null));
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return buildBinaryUpload(buffer, "places.xlsx");
  }

  it("POST /admin/imports/locations/preview returns valid, invalid and duplicate rows", async () => {
    _mockDiscoveryPlaceKeys = ["montevideo-centro"];
    const upload = await buildWorkbookUpload([
      { location_key: "montevideo-centro", display_name: "Montevideo Centro", parent_location: "Montevideo", kind: "barrio", lat_approx: "-34.90", lng_approx: "-56.19", commercial_score: "82", notes: "existente" },
      { location_key: "salto-centro", display_name: "Salto Centro", parent_location: "Salto", kind: "barrio", lat_approx: "-31.39", lng_approx: "-57.96", commercial_score: "74", notes: "nuevo" },
      { location_key: "", display_name: "Sin key", kind: "ciudad" },
    ]);

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/imports/locations/preview",
      headers: {
        authorization: "Bearer " + token,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid_count).toBe(2);
    expect(body.data.invalid_count).toBe(1);
    expect(body.data.duplicate_count).toBe(1);
    expect(body.data.entries).toHaveLength(2);
    expect(body.data.row_validation_errors[0]?.reason).toContain("missing location_key");
    await app.close();
  });

  it("DISC-15 seed XLSX preview accepts curated Uruguay fixture", async () => {
    _mockDiscoveryPlaceKeys = [];
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const buffer = await readFile(join(process.cwd(), "tests/discovery/fixtures/uruguay-location-seed.xlsx"));
    const upload = buildBinaryUpload(buffer, "uruguay-location-seed.xlsx");

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/imports/locations/preview",
      headers: {
        authorization: "Bearer " + token,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.filename).toBe("uruguay-location-seed.xlsx");
    expect(body.data.row_count).toBe(32);
    expect(body.data.valid_count).toBe(32);
    expect(body.data.invalid_count).toBe(0);
    expect(body.data.duplicate_count).toBe(0);
    expect(body.data.entries[0]).toMatchObject({ location_key: "montevideo-departamento", kind: "departamento" });
    expect(body.data.entries.some((entry: { location_key: string }) => entry.location_key === "peninsula-pde")).toBe(true);
    await app.close();
  });

  it("POST /admin/imports/locations/commit upserts entries and writes import audit metadata", async () => {
    upsertDiscoveryPlaces.mockResolvedValueOnce({ inserted: 1, updated: 0, skipped: 1, errors: [{ location_key: "montevideo-centro", reason: "duplicate — use upsert=true to overwrite" }] });

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/imports/locations/commit",
      headers: { authorization: "Bearer " + token },
      payload: {
        filename: "places.xlsx",
        upsert: false,
        entries: [
          { location_key: "montevideo-centro", display_name: "Montevideo Centro", parent_location: "Montevideo", kind: "barrio", lat_approx: -34.9, lng_approx: -56.19, commercial_score: 82, notes: "dup" },
          { location_key: "salto-centro", display_name: "Salto Centro", parent_location: "Salto", kind: "barrio", lat_approx: -31.39, lng_approx: -57.96, commercial_score: 74, notes: "new" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ inserted: 1, updated: 0, skipped: 1, duplicate_keys: ["montevideo-centro"] });
    expect(upsertDiscoveryPlaces).toHaveBeenCalledWith(expect.any(Array), "admin-user-id", false);
    await app.close();
  });

  it("GET /admin/imports/locations returns import history from audit log", async () => {
    _mockAuditLogRows = [
      {
        id: "audit-import-1",
        action: "discovery.places.import",
        occurred_at: "2026-05-27T12:00:00Z",
        actor_user_id: "admin-user-id",
        actor_role: "admin",
        diff: {
          filename: "places.xlsx",
          row_count: 12,
          inserted: 8,
          updated: 2,
          skipped: 1,
          invalid_count: 1,
          duplicate_count: 1,
          upsert: true,
        },
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/imports/locations?limit=10",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0]).toMatchObject({ filename: "places.xlsx", inserted: 8, updated: 2, invalid_count: 1, upsert: true });
    await app.close();
  });
  it("GET /discovery/location-suggestions returns explainable ranked suggestions", async () => {
    listDiscoveryPlaces.mockResolvedValue([
      {
        id: "city-montevideo",
        location_key: "montevideo",
        display_name: "Montevideo",
        parent_location: "Montevideo",
        kind: "ciudad",
        lat_approx: -34.9,
        lng_approx: -56.2,
        commercial_score: 88,
        notes: null,
        source: "xls_import",
        imported_at: "2026-05-01T00:00:00Z",
        imported_by_user_id: null,
      },
      {
        id: "barrio-pocitos",
        location_key: "pocitos",
        display_name: "Pocitos",
        parent_location: "Montevideo",
        kind: "barrio",
        lat_approx: -34.92,
        lng_approx: -56.15,
        commercial_score: 93,
        notes: null,
        source: "xls_import",
        imported_at: "2026-05-01T00:00:00Z",
        imported_by_user_id: null,
      },
    ]);
    _mockDiscoveryJobs = [
      {
        id: "job-1",
        batch_id: null,
        source: "google_places",
        location: "Montevideo",
        niche: "restaurant",
        status: "completed",
        enrich_after_discovery: false,
        enrich_status: "skipped",
        leads_found: 24,
        leads_new: 10,
        estimated_cost_usd: 2.4,
        completed_at: "2026-03-20T10:00:00Z",
        created_at: "2026-03-20T10:00:00Z",
      },
    ];
    _mockLeads = [
      { id: "lead-pocitos-1", niche: "restaurant", address: "Pocitos, Montevideo, Uruguay", prospect_score: 74, created_at: "2026-05-21T10:00:00Z" },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/location-suggestions?barrio=Pocitos&niche=restaurant&limit=5",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      confidence: "low",
      niche: "restaurant",
      catalog_entry: { location_key: "pocitos" },
      historical_metrics: { historical_scope: "parent", jobs_count: 1 },
    });
    expect(body.data[0].reasons.length).toBeGreaterThan(0);
    await app.close();
  });

  it("POST /discovery/job-batches persists predictive metadata in batch and child jobs", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const snapshot = {
      catalog_entry: { id: "catalog-pocitos", location_key: "pocitos", display_name: "Pocitos" },
      score: 78,
      confidence: "medium",
      reasons: ["Cobertura baja"],
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/job-batches",
      headers: { authorization: "Bearer " + token },
      payload: {
        sources: ["google_places", "yelu"],
        location: "Pocitos",
        niche: "restaurant",
        max_results: 120,
        cpu_budget: "balanced",
        google_places: { profile: "B", concurrency: 3, cost_cap_usd: 4 },
        recommendation_origin: { type: "predictive_location", key: "pocitos" },
        predictive_context: {
          suggestion_source: "predictive_location",
          location_catalog_entry_id: "catalog-pocitos",
          opportunity_score_snapshot: snapshot,
        },
        enrich_after_discovery: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(_lastInsertedDiscoveryBatch).toMatchObject({
      recommendation_origin: {
        type: "predictive_location",
        key: "pocitos",
        suggestion_source: "predictive_location",
        location_catalog_entry_id: "catalog-pocitos",
      },
    });
    expect(_lastInsertedDiscoveryJobs[0]).toMatchObject({
      triggered_by: "predictive_location",
      source_params: {
        suggestion_source: "predictive_location",
        location_catalog_entry_id: "catalog-pocitos",
      },
    });
    await app.close();
  });

  it("POST /discovery/jobs/bulk persists predictive metadata per job", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/discovery/jobs/bulk",
      headers: { authorization: "Bearer " + token },
      payload: {
        jobs: [
          {
            source: "google_places",
            location: "Pocitos",
            niche: "restaurant",
            max_results: 80,
            cost_cap_usd: 2,
            predictive_context: {
              suggestion_source: "predictive_location",
              location_catalog_entry_id: "catalog-pocitos",
              opportunity_score_snapshot: { score: 71 },
            },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(_lastInsertedDiscoveryJobs[0]).toMatchObject({
      source_params: {
        suggestion_source: "predictive_location",
        location_catalog_entry_id: "catalog-pocitos",
      },
    });
    await app.close();
  });

  it("GET /admin/geo/zones returns catalog-backed structured options with lead counts", async () => {
    listDiscoveryPlaces.mockResolvedValue([
      {
        id: "zone-1",
        location_key: "montevideo",
        display_name: "Montevideo",
        parent_location: "Montevideo",
        kind: "ciudad",
        lat_approx: -34.9,
        lng_approx: -56.2,
        commercial_score: 88,
        notes: null,
        source: "xls_import",
        imported_at: "2026-05-01T00:00:00Z",
        imported_by_user_id: null,
      },
    ]);
    _mockLeads = [
      { id: "lead-zone-1", source: "yelu", niche: "restaurant", address: "Montevideo, Uruguay", prospect_score: 72, contact_tier: "A", gps: { lat: -34.9, lng: -56.2 }, corroborating_sources: [], created_at: "2026-05-21T10:00:00Z" },
      { id: "lead-zone-2", source: "osm", niche: "hotel", address: "Montevideo, Uruguay", prospect_score: 65, contact_tier: "B", gps: { lat: -34.91, lng: -56.19 }, corroborating_sources: [], created_at: "2026-05-22T11:00:00Z" },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zones?q=monte",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0]).toMatchObject({ zone_id: "montevideo", label: "Montevideo", kind: "ciudad", lead_count: 2 });
    await app.close();
  });

  it("GET /admin/geo/lead-density falls back when leads.contact_tier is missing in legacy schema", async () => {
    _mockLeadSchemaMissingContactTier = true;
    _mockLeads = [
      {
        id: "lead-legacy",
        source: "yelu",
        niche: "restaurant",
        address: "Montevideo, Uruguay",
        prospect_score: 72,
        gps: { lat: -34.9, lng: -56.2 },
        corroborating_sources: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?limit=10",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.locations.length).toBeGreaterThan(0);
    await app.close();
  });


});

describe("Campaigns routes — implemented (Fase 43)", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    listDiscoveryPlaces.mockReset();
    listDiscoveryPlaces.mockResolvedValue([]);
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("GET /campaigns returns 200 with data array", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });
});

describe("Users routes — admin only", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("GET /users returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /users with CM role and null lead_filter returns 400 lead_filter_required", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: null,
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_filter_required");
    await app.close();
  });

  it("POST /users with CM role and empty lead_filter without ack returns 400", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: {},
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_filter_empty_requires_ack");
    await app.close();
  });

  it("POST /users with CM + empty lead_filter + acknowledge_unrestricted returns 201", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: {},
        acknowledge_unrestricted: true,
      }),
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("POST /users with CM + empty array in lead_filter returns 400 lead_filter_array_empty", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@x.com",
        password: "password12345",
        role: "cm",
        lead_filter: { contact_tier: [] },
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error_code).toBe("lead_filter_array_empty");
    await app.close();
  });
});

describe("Admin audit-log route", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
  });

  it("GET /admin/audit-log returns 403 for CM", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: { contact_tier: ["A"] }, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-log",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /admin/audit-log returns 200 for admin", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit-log",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("GET /admin/geo/zone-leads — MAP-4 individual mode", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _mockLeadSchemaMissingContactTier = false;
    _mockUser = {
      id: "admin-user-id",
      email: "admin@blindspot.local",
      role: "admin",
      lead_filter: null,
      active: true,
    };
    _mockLeads = [
      {
        id: "lead-1",
        name: "Restaurante El Parque",
        source: "yelu",
        niche: "restaurant",
        contact_tier: "A",
        prospect_score: 80,
        address: "Montevideo, Uruguay",
        gps: { lat: -34.9, lng: -56.2 },
        corroborating_sources: [],
      },
      {
        id: "lead-2",
        name: "Café Sur",
        source: "osm",
        niche: "café",
        contact_tier: "B",
        prospect_score: 60,
        address: "Salto, Uruguay",
        gps: null,
        corroborating_sources: [],
      },
    ];
  });

  it("returns 403 for CM users", async () => {
    _mockUser = { id: "cm-id", email: "cm@x.com", role: "cm", lead_filter: null, active: true };
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@x.com" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zone-leads?location_key=montevideo",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 400 when location_key is missing", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zone-leads",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("invalid_query");
    await app.close();
  });

  it("returns 200 with matching leads for a valid location_key", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zone-leads?location_key=montevideo",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("has_more");
    expect(Array.isArray(body.data)).toBe(true);
    // lead-1 has address "Montevideo, Uruguay" → location_key "montevideo"
    expect(body.data.some((lead: { id: string }) => lead.id === "lead-1")).toBe(true);
    expect(body.data[0]).toHaveProperty("map_point");
    // lead-2 has address "Salto, Uruguay" → different location_key
    expect(body.data.every((lead: { id: string }) => lead.id !== "lead-2")).toBe(true);
    await app.close();
  });

  it("returns zone leads without 500 when geocoding a scoped lead fails", async () => {
    geocodeAddress.mockImplementation(async () => {
      throw new Error("geocoder unavailable");
    });
    _mockLeads = [
      {
        id: "lead-zone-gps",
        name: "Restaurante GPS",
        source: "yelu",
        niche: "restaurant",
        contact_tier: "A",
        prospect_score: 80,
        address: "Montevideo, Uruguay",
        gps: { lat: -34.9, lng: -56.2 },
        corroborating_sources: [],
      },
      {
        id: "lead-zone-geocode-fails",
        name: "Restaurante Sin GPS",
        source: "osm",
        niche: "restaurant",
        contact_tier: "B",
        prospect_score: 60,
        address: "Calle Falla 123, Montevideo",
        gps: null,
        corroborating_sources: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zone-leads?location_key=montevideo",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data.map((lead: { id: string }) => lead.id)).toEqual(["lead-zone-gps"]);
    await app.close();
  });

  it("honors the shared filter contract when drilling into zone-leads", async () => {
    _mockLeads = [
      { id: "lead-zone-filter-match", name: "Restaurante Centro", source: "yelu", niche: "restaurant", contact_tier: "A", prospect_score: 82, address: "Montevideo, Uruguay", gps: { lat: -34.9, lng: -56.2 }, corroborating_sources: [], website: "https://centro.example.com", phone: "+59899111222", review_count: 48, primary_offer: "software_pos", pitch_hook: "POS con oportunidad inmediata", contact_ready: true, tags: ["instagram-confirmed"] },
      { id: "lead-zone-filter-tier-miss", name: "Hotel Centro", source: "yelu", niche: "hotel", contact_tier: "C", prospect_score: 85, address: "Montevideo, Uruguay", gps: { lat: -34.91, lng: -56.19 }, corroborating_sources: [] },
      { id: "lead-zone-filter-zone-miss", name: "Restaurante Salto", source: "yelu", niche: "restaurant", contact_tier: "A", prospect_score: 88, address: "Salto, Uruguay", gps: { lat: -31.39, lng: -57.96 }, corroborating_sources: [] },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zone-leads?location_key=montevideo&zone_ids=montevideo&source=yelu&niche=restaurant&prospect_score_gte=70&contact_tier=A",
      headers: { authorization: "Bearer " + token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data.map((lead: { id: string }) => lead.id)).toEqual(["lead-zone-filter-match"]);
    expect(body.data[0]).toMatchObject({ website: "https://centro.example.com", phone: "+59899111222", review_count: 48, primary_offer: "software_pos", pitch_hook: "POS con oportunidad inmediata", contact_ready: true, tags: ["instagram-confirmed"] });
    await app.close();
  });

  it("supports granular location keys and returns plottable geocoded leads", async () => {
    geocodeAddress.mockImplementation(async (address: string) => address.includes("Benito Blanco") ? { lat: -34.904, lng: -56.19 } : null);
    _mockLeads = [
      {
        id: "lead-gps",
        name: "Restaurante GPS",
        source: "yelu",
        niche: "restaurant",
        contact_tier: "A",
        prospect_score: 81,
        address: "Pocitos, Montevideo, Uruguay",
        gps: { lat: -34.905, lng: -56.191 },
        corroborating_sources: [],
      },
      {
        id: "lead-geocoded",
        name: "Restaurante Geocoded",
        source: "osm",
        niche: "restaurant",
        contact_tier: "B",
        prospect_score: 64,
        address: "Benito Blanco 1234, Pocitos, Montevideo",
        gps: null,
        corroborating_sources: [],
      },
      {
        id: "lead-other-zone",
        name: "Hotel Salto",
        source: "mintur",
        niche: "hotel",
        contact_tier: "C",
        prospect_score: 40,
        address: "Salto, Uruguay",
        gps: { lat: -31.39, lng: -57.97 },
        corroborating_sources: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const densityRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?limit=10&include_geocode=true",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(densityRes.statusCode).toBe(200);
    const densityBody = densityRes.json();
    const target = densityBody.data.locations.find((location: { lead_count: number; location_key: string }) => location.lead_count >= 2);
    expect(target?.location_key).toBeTruthy();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/geo/zone-leads?location_key=${encodeURIComponent(target.location_key)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((lead: { id: string }) => lead.id).sort()).toEqual(["lead-geocoded", "lead-gps"]);
    expect(body.data.find((lead: { id: string }) => lead.id === "lead-geocoded")?.map_point).toEqual({ lat: -34.904, lng: -56.19 });
    await app.close();
  });

  it("accepts the explicit parent/grid contract in parallel to the legacy location_key", async () => {
    _mockLeads = [
      {
        id: "lead-contract",
        name: "Contrato Zona",
        source: "yelu",
        niche: "restaurant",
        contact_tier: "A",
        prospect_score: 75,
        address: "Pocitos, Montevideo, Uruguay",
        gps: { lat: -34.905, lng: -56.191 },
        corroborating_sources: [],
      },
    ];

    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const densityRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/lead-density?limit=10",
      headers: { authorization: `Bearer ${token}` },
    });
    const target = densityRes.json().data.locations[0];
    const [, gridLocationKey] = String(target.location_key).split("::", 2);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/geo/zone-leads?parent_location_key=${encodeURIComponent(target.parent_location_key)}&grid_location_key=${encodeURIComponent(gridLocationKey)}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((lead: { id: string }) => lead.id)).toEqual(["lead-contract"]);
    await app.close();
  });

  it("respects the limit parameter and signals has_more", async () => {
    // Add a second Montevideo lead
    _mockLeads = [
      ...(_mockLeads as Array<Record<string, unknown>>),
      {
        id: "lead-3",
        name: "Hotel Central",
        source: "mintur",
        niche: "hotel",
        contact_tier: "A",
        prospect_score: 90,
        address: "Montevideo, Uruguay",
        gps: { lat: -34.91, lng: -56.19 },
        corroborating_sources: [],
      },
    ];
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "admin-user-id", email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/geo/zone-leads?location_key=montevideo&limit=1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(1);
    expect(body.total).toBe(2);
    expect(body.has_more).toBe(true);
    await app.close();
  });
});
