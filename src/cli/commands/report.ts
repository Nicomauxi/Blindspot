import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getLogger } from "../../shared/logger.js";
import { loadLeadsByRunId } from "../../storage/leads.js";
import { getRunById } from "../../storage/runs.js";
import { generateReports } from "../../modules/reporting/index.js";
import type { ReportFormat } from "../../modules/reporting/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ReportArgsSchema = z.object({
  run: z.string().regex(UUID_RE, "run must be a valid UUID"),
  format: z.enum(["csv", "html", "md", "all"]).default("all"),
  outputDir: z.string().min(1).optional(),
  minProspect: z.coerce.number().int().min(0).max(100).default(0),
});

interface RawReportArgs {
  run: string;
  format?: string;
  outputDir?: string;
  minProspect?: string | number;
}

export async function reportCommand(rawArgs: RawReportArgs): Promise<void> {
  const log = getLogger();

  const parsed = ReportArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msgs = parsed.error.issues
      .map((e) => `  ${e.path.map(String).join(".")}: ${e.message}`)
      .join("\n");
    log.error(`Invalid arguments:\n${msgs}`);
    process.exit(1);
  }

  const opts = parsed.data;

  const run = await getRunById(opts.run);
  if (!run) {
    log.error({ runId: opts.run }, "Run not found");
    process.exit(1);
  }

  const leads = await loadLeadsByRunId(opts.run);
  log.info({ runId: opts.run, total: leads.length }, "Leads loaded");

  const outDir = opts.outputDir ?? join("reports", opts.run);
  await mkdir(outDir, { recursive: true });

  const artifacts = generateReports(leads, {
    format: opts.format as ReportFormat,
    minProspect: opts.minProspect,
    runMeta: {
      runId: opts.run,
      niche: run.niche,
      location: run.location,
      generatedAt: new Date().toISOString(),
    },
  });

  const writtenPaths: string[] = [];

  if (artifacts.csv !== undefined) {
    const p = join(outDir, "leads.csv");
    await writeFile(p, artifacts.csv, "utf-8");
    writtenPaths.push(p);
  }

  if (artifacts.html !== undefined) {
    const p = join(outDir, "dashboard.html");
    await writeFile(p, artifacts.html, "utf-8");
    writtenPaths.push(p);
  }

  if (artifacts.md !== undefined) {
    const mdDir = join(outDir, "leads");
    await mkdir(mdDir, { recursive: true });
    for (const [filename, content] of artifacts.md) {
      const p = join(mdDir, filename);
      await writeFile(p, content, "utf-8");
      writtenPaths.push(p);
    }
  }

  log.info({ paths: writtenPaths }, "Report files written");

  console.log(`\nReporte generado para run ${opts.run}`);
  console.log(`Leads cargados:   ${leads.length}`);
  console.log(`Archivos escritos:`);
  for (const p of writtenPaths) {
    console.log(`  ${p}`);
  }
}
