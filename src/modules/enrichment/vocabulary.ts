import { STOP_WORDS, tokenizeFromSlug } from "./heuristic-discovery.js";

export function computeNicheStopWords(
  leads: Array<Pick<{ name: string }, "name">>,
  minCount = 3,
  minFraction = 0.05
): Map<string, number> {
  if (leads.length === 0) return new Map();

  const wordCounts = new Map<string, number>();

  for (const lead of leads) {
    const tokens = tokenizeFromSlug(lead.name);
    const uniqueWords = new Set(
      tokens.filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    );
    for (const word of uniqueWords) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  // threshold: a word must appear in at least this many leads.
  // minCount-1 lets the caller express "at least N peers plus self",
  // floored at 1 so minCount=1 always allows count=1 words through.
  const threshold = Math.max(minCount - 1, Math.ceil(leads.length * minFraction), 1);

  return new Map(
    [...wordCounts.entries()].filter(([, count]) => count >= threshold)
  );
}
