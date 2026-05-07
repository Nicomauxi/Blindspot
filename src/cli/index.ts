import { Command } from "commander";
import { discoverCommand } from "./commands/discover.js";

const program = new Command();

program
  .name("gap-radar")
  .description(
    "Identify local businesses with strong offline reputation but poor digital presence"
  )
  .version("1.0.0");

program
  .command("discover")
  .description(
    "Search Google Places for leads matching a niche+location, filter by profile, persist results"
  )
  .requiredOption("--niche <string>", "Business niche to search for (e.g. 'peluquería')")
  .requiredOption("--location <string>", "Location to search in (e.g. 'Montevideo Uruguay')")
  .requiredOption(
    "--profile <a|b>",
    "Filter profile: a=hidden gem (high rating, few reviews, no/social web), b=saturated no-web (many reviews, no website)"
  )
  .option("--max-results <number>", "Max places to retrieve from Places API", "50")
  .option("--min-rating <number>", "Minimum rating override", "4.0")
  .action(async (opts: {
    niche: string;
    location: string;
    profile: string;
    maxResults: string;
    minRating: string;
  }) => {
    await discoverCommand({
      niche: opts.niche,
      location: opts.location,
      profile: opts.profile,
      maxResults: opts.maxResults,
      minRating: opts.minRating,
    });
  });

program.parse(process.argv);
