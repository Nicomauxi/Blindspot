import type { Lead } from "../../shared/types.js";

export type ReportFormat = "csv" | "html" | "md" | "all";

export interface RunMeta {
  runId: string;
  niche: string | null;
  location: string | null;
  generatedAt: string;
}

export interface BreakdownRule {
  name: string;
  weight: number;
  matched_value: unknown;
}

export interface ParsedBreakdown {
  computed_at: string;
  config_version: number;
  business_quality: { total: number; rules: BreakdownRule[] };
  digital_gap: { total: number; rules: BreakdownRule[] };
  systems_gap: { total: number; rules: BreakdownRule[] };
  prospect: { formula: string; total: number };
}

export type ProspectColor = "red" | "yellow" | "green";

export interface ScoreBucket {
  range: "70-100" | "50-69" | "30-49" | "0-29" | "no-score";
  count: number;
  color: "green" | "yellow" | "red" | "gray";
}

export interface ReportLeadView {
  rank: number;
  lead: Lead;
  color: ProspectColor;
  displayTags: string[];
  mapsUrl: string;
  prospectDisplay: string;
  bqDisplay: string;
  dgDisplay: string;
  sgDisplay: string;
  prospectVal: string;
  bqVal: string;
  dgVal: string;
  sgVal: string;
  searchText: string;
  footprintSummary: string;
  breakdown: ParsedBreakdown | null;
  scoreless: boolean;
}

export interface GenerateReportsOptions {
  format: ReportFormat;
  minProspect: number;
  runMeta: RunMeta;
}

export interface GeneratedArtifacts {
  csv?: string;
  html?: string;
  md?: Map<string, string>;
}
