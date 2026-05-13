import { Command } from "commander";
import pLimit from "p-limit";
import { z } from "zod";
import { discoverCommand } from "./discover.js";
import { enrichCommand } from "./enrich.js";
import { scoreCommand } from "./score.js";
import { socialEnrichCommand } from "./social-enrich.js";
import { loadLeadsByRunId } from "../../storage/leads.js";
import { getLogger } from "../../shared/logger.js";
import { getSupabase } from "../../shared/supabase.js";
import { computeConcurrency, type RamMode } from "../../shared/ram.js";
import type { Lead } from "../../shared/types.js";

const log = getLogger();

const RunArgsSchema = z
  .object({
    niche: z.string().min(1),
    location: z.array(z.string().min(1)).min(1),
    profile: z.enum(["a", "b", "c", "d", "all", "both"]),
    maxResults: z.coerce.number().int().positive().default(15),
    ramMode: z.enum(["conservative", "auto", "manual"]).default("conservative"),
    concurrency: z.coerce.number().int().positive().optional(),
    scoreThreshold: z.coerce.number().int().min(0).default(40),
    noSocial: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    overrides: z.array(z.string()).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.ramMode !== "manual" && value.concurrency !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--concurrency can only be used with --ram-mode manual",
        path: ["concurrency"],
      });
    }
  });

type RunArgs = z.infer<typeof RunArgsSchema>;
type PipelineProfile = "a" | "b" | "c" | "d";

interface TopLeadSummary {
  name: string;
  placeId: string;
  prospectScore: number;
}

interface LeadSummary {
  passed: number;
  hot: number;
  topLead: TopLeadSummary | null;
  leads: Lead[];
}

interface PipelineSummary {
  location: string;
  profile: PipelineProfile;
  runId: string;
  discovered: number;
  newLeads: number;
  passed: number;
  hot: number;
  topLead: TopLeadSummary | null;
  socialRan: boolean;
  leads: Lead[];
}

interface RunRow {
  id: string;
  stats: Record<string, unknown> | null;
}

function collectLocation(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectOverride(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function expandProfiles(profile: RunArgs["profile"]): PipelineProfile[] {
  if (profile === "all") return ["a", "b", "c", "d"];
  if (profile === "both") return ["a", "b"];
  return [profile];
}

function pickTopLead(leads: Lead[]): TopLeadSummary | null {
  const top = [...leads]
    .filter(
      (lead): lead is Lead & { prospect_score: number } =>
        typeof lead.prospect_score === "number"
    )
    .sort((left, right) => {
      const scoreDiff = right.prospect_score - left.prospect_score;
      if (scoreDiff !== 0) return scoreDiff;
      return left.name.localeCompare(right.name);
    })[0];

  if (!top) return null;

  return {
    name: top.name,
    placeId: top.place_id,
    prospectScore: top.prospect_score,
  };
}

function buildLeadSummary(leads: Lead[], scoreThreshold: number): LeadSummary {
  const passedLeads = leads.filter((lead) => lead.passed_filter);
  const hotLeads = passedLeads.filter(
    (lead) =>
      typeof lead.prospect_score === "number" &&
      lead.prospect_score >= scoreThreshold
  );
  return {
    passed: passedLeads.length,
    hot: hotLeads.length,
    topLead: pickTopLead(passedLeads),
    leads,
  };
}

async function resolveLatestDiscoverRun(
  niche: string,
  location: string,
  profile: PipelineProfile
): Promise<RunRow> {
  const { data, error } = await getSupabase()
    .from("runs")
    .select("id, stats")
    .eq("niche", niche)
    .eq("location", location)
    .eq("profile", profile)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();

  if (error || !data) {
    throw new Error(
      `Failed to resolve discover run for ${niche}/${location}/${profile}: ${error?.message ?? "not found"}`
    );
  }

  return data;
}

async function runPipeline(
  args: {
    niche: string;
    location: string;
    profile: PipelineProfile;
    maxResults: number;
    overrides: string[];
    scoreThreshold: number;
    noSocial: boolean;
    dryRun: boolean;
  }
): Promise<PipelineSummary> {
  await discoverCommand({
    niche: args.niche,
    location: args.location,
    profile: args.profile,
    maxResults: args.maxResults,
    override: args.overrides,
  });

  const latestRun = await resolveLatestDiscoverRun(
    args.niche,
    args.location,
    args.profile
  );
  const stats = latestRun.stats ?? {};
  const discovered =
    Number(stats.leads_discovered ?? 0) + Number(stats.leads_rejected ?? 0);
  const newLeads = Number(stats.leads_new ?? 0);

  if (args.dryRun) {
    return {
      location: args.location,
      profile: args.profile,
      runId: latestRun.id,
      discovered,
      newLeads,
      passed: Number(stats.leads_discovered ?? 0),
      hot: 0,
      topLead: null,
      socialRan: false,
      leads: [],
    };
  }

  if (newLeads > 0) {
    await enrichCommand({
      run: latestRun.id,
      forceRefresh: false,
      withHeuristic: true,
      concurrency: "5",
      all: false,
    });
  }

  await scoreCommand({
    run: latestRun.id,
    all: false,
    dryRun: false,
  });

  let leads = await loadLeadsByRunId(latestRun.id, { passedOnly: false });
  let summary = buildLeadSummary(leads, args.scoreThreshold);
  let socialRan = false;

  if (!args.noSocial && summary.hot > 0) {
    await socialEnrichCommand({
      run: latestRun.id,
      all: false,
      limit: 10,
      force: false,
    });
    await scoreCommand({
      run: latestRun.id,
      all: false,
      dryRun: false,
    });
    leads = await loadLeadsByRunId(latestRun.id, { passedOnly: false });
    summary = buildLeadSummary(leads, args.scoreThreshold);
    socialRan = true;
  }

  return {
    location: args.location,
    profile: args.profile,
    runId: latestRun.id,
    discovered,
    newLeads,
    passed: summary.passed,
    hot: summary.hot,
    topLead: summary.topLead,
    socialRan,
    leads: summary.leads,
  };
}

function printSummary(
  results: PipelineSummary[],
  scoreThreshold: number,
  ram: ReturnType<typeof computeConcurrency>
): void {
  const totalDiscovered = results.reduce(
    (sum, result) => sum + result.discovered,
    0
  );
  const totalPassed = results.reduce((sum, result) => sum + result.passed, 0);
  const totalHot = results.reduce((sum, result) => sum + result.hot, 0);
  const topLeads = results
    .flatMap((result) => result.leads.filter((lead) => lead.passed_filter))
    .filter(
      (lead): lead is Lead & { prospect_score: number } =>
        typeof lead.prospect_score === "number"
    )
    .sort((left, right) => {
      const scoreDiff = right.prospect_score - left.prospect_score;
      if (scoreDiff !== 0) return scoreDiff;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 5);

  console.log("Blindspot run summary");
  console.log(`Pipelines: ${results.length}`);
  console.log(
    `RAM mode: ${ram.mode} | concurrency: ${ram.concurrency} | free MB: ${Math.round(ram.freeRamMb)}`
  );
  console.log(`Total leads discovered: ${totalDiscovered}`);
  console.log(`Total passed: ${totalPassed}`);
  console.log(`Total hot (score >= ${scoreThreshold}): ${totalHot}`);
  console.log("Top 5 leads:");
  if (topLeads.length === 0) {
    console.log("- none");
    return;
  }
  for (const lead of topLeads) {
    console.log(`- ${lead.name} (${lead.prospect_score})`);
  }
}

export async function runCommandAction(rawArgs: Partial<RunArgs>): Promise<void> {
  const args = RunArgsSchema.parse({
    maxResults: 15,
    ramMode: "conservative",
    scoreThreshold: 40,
    noSocial: false,
    dryRun: false,
    ...rawArgs,
  });

  const ram = computeConcurrency(args.ramMode as RamMode, args.concurrency);
  const jobs = args.location.flatMap((location) =>
    expandProfiles(args.profile).map((profile) => ({
      niche: args.niche,
      location,
      profile,
      maxResults: args.maxResults,
      overrides: args.overrides,
      scoreThreshold: args.scoreThreshold,
      noSocial: args.noSocial,
      dryRun: args.dryRun,
    }))
  );

  log.info(
    {
      pipelines: jobs.length,
      concurrency: ram.concurrency,
      freeRamMb: Math.round(ram.freeRamMb),
      mode: ram.mode,
    },
    "Starting blindspot run"
  );

  const limit = pLimit(ram.concurrency);
  const results = await Promise.all(jobs.map((job) => limit(() => runPipeline(job))));
  printSummary(results, args.scoreThreshold, ram);
}

export const runCommand = new Command("run")
  .description("Run the full Blindspot pipeline across location/profile combinations")
  .requiredOption("--niche <text>", "Niche to discover")
  .requiredOption(
    "--location <text>",
    "Location to process; repeat for multiple locations",
    collectLocation,
    []
  )
  .requiredOption("--profile <a|b|c|d|all>", "Profile to use")
  .option("--max-results <N>", "Maximum results per discover run", "15")
  .option(
    "--ram-mode <conservative|auto|manual>",
    "RAM-aware pipeline concurrency mode",
    "conservative"
  )
  .option("--concurrency <N>", "Manual pipeline concurrency override")
  .option(
    "--score-threshold <N>",
    "Minimum prospect score for hot leads / social enrich",
    "40"
  )
  .option("--no-social", "Skip social-enrich step")
  .option("--dry-run", "Discover only; skip enrich and scoring")
  .option(
    "--override <kv...>",
    "Override profile parameters (e.g. min_reviews=50)",
    collectOverride,
    []
  )
  .action(async (options) => {
    try {
      await runCommandAction(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, "blindspot run failed");
      console.error(message);
      process.exit(1);
    }
  });
