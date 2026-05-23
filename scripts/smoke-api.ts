import process from "node:process";
import { buildServer } from "../api/src/server.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type LoginBody = { token: string; role: "admin" | "cm" };

async function login(app: Awaited<ReturnType<typeof buildServer>>, email: string, password: string): Promise<LoginBody> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  assert(res.statusCode == 200, `login failed for ${email}: ${res.statusCode} ${res.body}`);
  return res.json<LoginBody>();
}

async function main() {
  process.env.API_JWT_SECRET ??= "test-secret-at-least-32-chars-long-1234";

  const app = await buildServer();
  try {
    const results: Record<string, unknown> = {};

    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert(health.statusCode === 200, `health failed: ${health.statusCode} ${health.body}`);
    const healthBody = health.json<Record<string, unknown>>();
    assert(healthBody["status"] === "ok", `health status is not ok: ${JSON.stringify(healthBody)}`);
    const invariants = healthBody["invariants"] as Record<string, unknown> | undefined;
    assert(invariants?.["lead_dashboard_schema_current"] === true, "lead_dashboard schema is not current");
    results["health"] = {
      status: healthBody["status"],
      db: healthBody["db"],
      lead_dashboard_schema_current: invariants?.["lead_dashboard_schema_current"] ?? null,
    };

    const admin = await login(app, "admin@blindspot.local", "admin_local_2026");
    const cm = await login(app, "cm@blindspot.local", "cm_local_2026");
    results["login"] = {
      admin_role: admin.role,
      cm_role: cm.role,
    };

    const adminLeads = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(adminLeads.statusCode === 200, `admin leads failed: ${adminLeads.statusCode} ${adminLeads.body}`);
    results["leads"] = adminLeads.json<Record<string, unknown>>();

    const campaigns = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(campaigns.statusCode === 200, `campaigns failed: ${campaigns.statusCode} ${campaigns.body}`);
    results["campaigns"] = campaigns.json<Record<string, unknown>>();

    const outreach = await app.inject({
      method: "GET",
      url: "/api/v1/outreach",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(outreach.statusCode === 200, `outreach failed: ${outreach.statusCode} ${outreach.body}`);
    results["outreach"] = outreach.json<Record<string, unknown>>();

    const discoveryJobs = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/jobs",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(discoveryJobs.statusCode === 200, `discovery jobs failed: ${discoveryJobs.statusCode} ${discoveryJobs.body}`);
    results["discovery_jobs"] = discoveryJobs.json<Record<string, unknown>>();

    const discoveryBatches = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/job-batches",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(discoveryBatches.statusCode === 200, `discovery batches failed: ${discoveryBatches.statusCode} ${discoveryBatches.body}`);
    results["discovery_batches"] = discoveryBatches.json<Record<string, unknown>>();

    const pipelineConfig = await app.inject({
      method: "GET",
      url: "/api/v1/pipeline/config",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(pipelineConfig.statusCode === 200, `pipeline config failed: ${pipelineConfig.statusCode} ${pipelineConfig.body}`);
    results["pipeline_config"] = pipelineConfig.json<Record<string, unknown>>();

    const backups = await app.inject({
      method: "GET",
      url: "/api/v1/admin/backups",
      headers: { authorization: `Bearer ${admin.token}` },
    });
    assert(backups.statusCode === 200, `admin backups failed: ${backups.statusCode} ${backups.body}`);
    results["backups"] = backups.json<Record<string, unknown>>();

    const cmUsers = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${cm.token}` },
    });
    assert(cmUsers.statusCode === 403, `cm users should be 403, got ${cmUsers.statusCode} ${cmUsers.body}`);
    results["rbac"] = { cm_users_status: cmUsers.statusCode };

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
