import { STOP_WORDS, getHeuristicConfig, tokenizeFromSlug } from "./heuristic-discovery.js";

const VOCABULARY_STOP_WORDS = new Set(["center", "centre", "centro"]);

export function getVocabularyStopWords(): ReadonlySet<string> {
  const config = getHeuristicConfig();
  return new Set([
    ...STOP_WORDS,
    ...VOCABULARY_STOP_WORDS,
    ...config.geographic_stop_words,
    ...config.proper_noun_stop_words,
  ]);
}

export function computeNicheStopWords(
  leads: Array<Pick<{ name: string }, "name">>,
  minCount = 3,
  minFraction = 0.05
): Map<string, number> {
  if (leads.length === 0) return new Map();

  const wordCounts = new Map<string, number>();
  const stopWords = getVocabularyStopWords();

  for (const lead of leads) {
    const tokens = tokenizeFromSlug(lead.name);
    const uniqueWords = new Set(
      tokens.filter((w) => w.length >= 4 && !stopWords.has(w))
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
