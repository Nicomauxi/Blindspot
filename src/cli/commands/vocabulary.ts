import { getLogger } from "../../shared/logger.js";
import { loadAllLeads } from "../../storage/leads.js";
import {
  rebuildVocabularyForNiche,
  showVocabularyForNiche,
} from "../../storage/vocabulary.js";
import { computeNicheStopWords } from "../../modules/enrichment/vocabulary.js";
import type { Lead } from "../../shared/types.js";

const DEFAULT_MIN_COUNT = 3;
const DEFAULT_MIN_FRACTION = 0.05;

interface VocabularyRebuildArgs {
  subcommand: "rebuild";
  all?: boolean;
  niche?: string;
  minCount?: number;
  minFraction?: number;
}

interface VocabularyShowArgs {
  subcommand: "show";
  niche?: string;
}

export type VocabularyArgs = VocabularyRebuildArgs | VocabularyShowArgs;

async function rebuildAll(
  minCount: number,
  minFraction: number
): Promise<void> {
  const log = getLogger();
  const leads = await loadAllLeads();

  const byNiche = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (!lead.niche || lead.niche === "all") continue;
    const bucket = byNiche.get(lead.niche) ?? [];
    bucket.push(lead);
    byNiche.set(lead.niche, bucket);
  }

  if (byNiche.size === 0) {
    log.info("No leads with assigned niches found — nothing to rebuild.");
    return;
  }

  for (const [niche, nicheLeads] of byNiche) {
    const wordCounts = computeNicheStopWords(nicheLeads, minCount, minFraction);
    await rebuildVocabularyForNiche(niche, wordCounts);
    log.info({ niche, words: wordCounts.size, leads: nicheLeads.length }, "vocabulary rebuilt");
  }
}

async function rebuildForNiche(
  niche: string,
  minCount: number,
  minFraction: number
): Promise<void> {
  if (niche === "all") {
    throw new Error("niche='all' is reserved for seeds and cannot be rebuilt via this command");
  }
  const log = getLogger();
  const leads = await loadAllLeads();
  const nicheLeads = leads.filter((l) => l.niche === niche);

  const wordCounts = computeNicheStopWords(nicheLeads, minCount, minFraction);
  await rebuildVocabularyForNiche(niche, wordCounts);
  log.info({ niche, words: wordCounts.size, leads: nicheLeads.length }, "vocabulary rebuilt");
}

export async function vocabularyCommand(args: VocabularyArgs): Promise<void> {
  if (args.subcommand === "show") {
    if (!args.niche) {
      throw new Error("--niche is required for the show subcommand");
    }
    const rows = await showVocabularyForNiche(args.niche);
    if (rows.length === 0) {
      console.log(`No vocabulary found for niche '${args.niche}'.`);
      return;
    }
    console.log(`\nVocabulary for niche '${args.niche}' (${rows.length} words):\n`);
    const maxWord = Math.max(...rows.map((r) => r.word.length), 4);
    console.log(`${"WORD".padEnd(maxWord)}  COUNT  SOURCE`);
    console.log(`${"-".repeat(maxWord)}  -----  --------`);
    for (const row of rows) {
      console.log(`${row.word.padEnd(maxWord)}  ${String(row.count).padStart(5)}  ${row.source}`);
    }
    return;
  }

  // rebuild subcommand
  const rebuildArgs = args as VocabularyRebuildArgs;
  const minCount = rebuildArgs.minCount ?? DEFAULT_MIN_COUNT;
  const minFraction = rebuildArgs.minFraction ?? DEFAULT_MIN_FRACTION;

  if (rebuildArgs.all) {
    await rebuildAll(minCount, minFraction);
    return;
  }

  if (rebuildArgs.niche) {
    await rebuildForNiche(rebuildArgs.niche, minCount, minFraction);
    return;
  }

  throw new Error("vocabulary rebuild requires --all or --niche <name>");
}
