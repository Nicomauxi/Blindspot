import { listLeads } from "../../storage/leads.js";
import type { Lead } from "../../shared/types.js";

export async function leadsListCommand(opts: {
  run?: string;
  rejectedOnly?: boolean;
  passedOnly?: boolean;
  limit?: string;
  format?: string;
}): Promise<void> {
  const limit = opts.limit ? parseInt(opts.limit, 10) : 100;
  const format = opts.format ?? "table";

  const leads = await listLeads({
    ...(opts.run !== undefined ? { runId: opts.run } : {}),
    passedOnly: opts.passedOnly ?? false,
    rejectedOnly: opts.rejectedOnly ?? false,
    limit,
  });

  if (format === "json") {
    console.log(JSON.stringify(leads, null, 2));
    return;
  }

  printTable(leads);
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function printTable(leads: Lead[]): void {
  if (leads.length === 0) {
    console.log("No leads found.");
    return;
  }

  const header = [
    "name".padEnd(30),
    "rating".padEnd(7),
    "reviews".padEnd(8),
    "website".padEnd(42),
    "passed".padEnd(7),
    "rejection_reasons".padEnd(40),
    "tags",
  ].join(" | ");

  const separator = "-".repeat(header.length);

  console.log(header);
  console.log(separator);

  for (const lead of leads) {
    const row = [
      truncate(lead.name, 30).padEnd(30),
      String(lead.rating ?? "").padEnd(7),
      String(lead.review_count ?? "").padEnd(8),
      truncate(lead.website, 40).padEnd(42),
      String(lead.passed_filter).padEnd(7),
      truncate(lead.rejection_reasons?.join(", "), 40).padEnd(40),
      lead.tags?.join("|") ?? "",
    ].join(" | ");
    console.log(row);
  }
}
