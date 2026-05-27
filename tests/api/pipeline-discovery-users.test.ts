import { describe, it, expect, vi, beforeEach } from "vitest";

const startFilterEnrichmentJob = vi.fn();
const countLeadsByFilterSelection = vi.fn();
const geocodeAddress = vi.fn();

vi.mock("../../src/cli/commands/enrich.js", () => ({
  startFilterEnrichmentJob,
}));

vi.mock("../../src/storage/leads.js", () => ({
  countLeadsByFilterSelection,
}));

vi.mock("../../api/src/services/lead-geocoding.js", () => ({
  createLeadGeocodingService: () => ({ geocodeAddress }),
}));

let _activePipelineRun: Record<string, unknown> | null = null;
let _mockLeadSchemaMissingContactTier = false;

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
            in: (_c: string, values: unknown[]) => ({
              limit: (_n: number) => ({
                maybeSingle: async () => ({
                  data: _activePipelineRun && values.includes(_activePipelineRun["status"]) ? _activePipelineRun : null,
                }),
              }),
              order: () => ({
                limit: (_n: number) =>
                  Promise.resolve({ data: [], error: null, count: 0 }),
              }),
            }),
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
      if (table === "discovery_jobs") {
        return {
          select: (_cols: string, _opts?: unknown) => ({
            order: () => ({
              limit: (_n: number) => Promise.resolve({
                data: [
                  {
                    id: "legacy-job-id",
                    batch_id: null,
                    source: "yelu",
                    location: "Montevideo",
                    niche: "restaurant",
                    status: "queued",
                    enrich_after_discovery: false,
                    enrich_status: "skipped",
                    created_at: "2026-05-20T10:00:00Z",
                  },
                ],
                error: null,
                count: 1,
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
              data: [
                { source: "yelu", niche: "restaurant", location: "Montevideo", created_at: "2026-05-20T10:00:00Z" },
              ],
              error: null,
            }),
          }),
          insert: (payload: unknown) => ({
            select: () => ({
              single: async () => ({
                data: { id: "new-job-id", status: "queued", batch_id: null },
                error: null,
              }),
              then: (cb: (value: unknown) => void) => cb({
                data: Array.isArray(payload)
                  ? payload.map((entry, index) => ({ id: `child-job-${index + 1}`, ...(entry as object) }))
                  : [],
                error: null,
              }),
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
              single: async () => ({
                data: { id: "batch-1", status: "queued", created_at: "2026-05-20T10:00:00Z", ...(payload as object) },
                error: null,
              }),
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
                Promise.resolve({ data: [], error: null, count: 0 }),
            }),
            eq: () => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
            }),
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
      url: "/api/v1/admin/geo/lead-density?limit=10",
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
