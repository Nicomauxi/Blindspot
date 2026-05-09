import type { Lead } from "../../shared/types.js";
import { sortLeadsForReport } from "./shared.js";
import { generateCsv } from "./csv.js";
import { generateHtml } from "./html.js";
import { generateMdPerLead } from "./md.js";
import type {
  GeneratedArtifacts,
  GenerateReportsOptions,
  ReportFormat,
} from "./types.js";

export type { ReportFormat, GeneratedArtifacts, GenerateReportsOptions };
export type { RunMeta } from "./types.js";

export function generateReports(
  leads: Lead[],
  opts: GenerateReportsOptions
): GeneratedArtifacts {
  // When minProspect > 0, leads with null prospect_score are excluded because
  // (null ?? 0) === 0 < minProspect. Intentional: --min-prospect N means
  // "only leads that have been scored AND have prospect >= N".
  const filtered =
    opts.minProspect > 0
      ? leads.filter((l) => (l.prospect_score ?? 0) >= opts.minProspect)
      : leads;

  const sorted = sortLeadsForReport(filtered);
  const result: GeneratedArtifacts = {};

  const wantsCsv = opts.format === "csv" || opts.format === "all";
  const wantsHtml = opts.format === "html" || opts.format === "all";
  const wantsMd = opts.format === "md" || opts.format === "all";

  if (wantsCsv) result.csv = generateCsv(sorted);
  if (wantsHtml) result.html = generateHtml(sorted, opts.runMeta);
  if (wantsMd) result.md = generateMdPerLead(sorted, opts.runMeta.runId);

  return result;
}
