import { getOutreachStats } from "../../storage/outreach.js";

export interface OutreachCommandOptions {
  stats: boolean;
}

export async function outreachCommand(opts: OutreachCommandOptions): Promise<void> {
  if (!opts.stats) {
    console.log("No subcommand specified. Use --stats to view outreach statistics.");
    return;
  }

  const stats = await getOutreachStats();

  console.log("\n=== Outreach Stats ===");
  console.log(`Total outreach records: ${stats.total}`);
  if (stats.total === 0) {
    console.log("No outreach records found.\n");
    return;
  }

  console.log(`\nConversion rate (closed_won): ${(stats.conversion_rate * 100).toFixed(1)}%`);
  console.log(`Response rate:               ${(stats.response_rate * 100).toFixed(1)}%`);

  console.log("\nBy status:");
  for (const [status, count] of Object.entries(stats.by_status).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${status.padEnd(16)} ${count.toString().padStart(4)}  (${pct}%)`);
  }

  console.log("\nBy channel:");
  for (const [channel, count] of Object.entries(stats.by_channel).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${channel.padEnd(16)} ${count.toString().padStart(4)}  (${pct}%)`);
  }

  if (Object.keys(stats.by_outcome).length > 0) {
    console.log("\nBy outcome:");
    for (const [outcome, count] of Object.entries(stats.by_outcome).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / stats.total) * 100).toFixed(1);
      console.log(`  ${outcome.padEnd(16)} ${count.toString().padStart(4)}  (${pct}%)`);
    }
  }

  console.log();
}
