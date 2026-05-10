import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";

export interface VocabularyEntry {
  word: string;
  count: number;
  source: string;
}

export async function loadFilterWordsForNiche(niche: string): Promise<Set<string>> {
  // Seeds are always included regardless of count.
  // Computed words require count >= 5 to qualify as generic enough to suppress.
  // Universal seeds (niche='all') are always included.
  const filter =
    `and(niche.eq.${niche},or(source.eq.seed,count.gte.5)),` +
    `and(niche.eq.all,source.eq.seed)`;

  try {
    const { data, error } = await getSupabase()
      .from("niche_vocabulary")
      .select("word")
      .or(filter);

    if (error) {
      getLogger().warn({ niche, err: error.message }, "loadFilterWordsForNiche failed — using empty set");
      return new Set();
    }

    return new Set((data ?? []).map((r: { word: string }) => r.word));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ niche, err: msg }, "loadFilterWordsForNiche threw — using empty set");
    return new Set();
  }
}

export async function loadVocabularyForNiche(niche: string): Promise<Set<string>> {
  try {
    const { data, error } = await getSupabase()
      .from("niche_vocabulary")
      .select("word")
      .or(`niche.eq.${niche},and(niche.eq.all,source.eq.seed)`);

    if (error) {
      getLogger().warn({ niche, err: error.message }, "niche_vocabulary load failed — using empty set");
      return new Set();
    }

    return new Set((data ?? []).map((r: { word: string }) => r.word));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ niche, err: msg }, "niche_vocabulary load threw — using empty set");
    return new Set();
  }
}

export async function rebuildVocabularyForNiche(
  niche: string,
  wordCounts: Map<string, number>
): Promise<void> {
  if (niche === "all") {
    throw new Error("rebuildVocabularyForNiche: niche='all' is reserved for seeds — computed rows may not use it");
  }

  const db = getSupabase();

  const { error: deleteError } = await db
    .from("niche_vocabulary")
    .delete()
    .eq("niche", niche);

  if (deleteError) {
    throw new Error(`Failed to delete existing vocabulary for niche '${niche}': ${deleteError.message}`);
  }

  if (wordCounts.size === 0) return;

  const rows = [...wordCounts.entries()].map(([word, count]) => ({
    niche,
    word,
    count,
    source: "computed" as const,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await db
    .from("niche_vocabulary")
    .upsert(rows, { onConflict: "niche,word" });

  if (upsertError) {
    throw new Error(`Failed to upsert vocabulary for niche '${niche}': ${upsertError.message}`);
  }
}

export async function showVocabularyForNiche(niche: string): Promise<VocabularyEntry[]> {
  try {
    const { data, error } = await getSupabase()
      .from("niche_vocabulary")
      .select("word, count, source")
      .eq("niche", niche)
      .order("count", { ascending: false });

    if (error) {
      getLogger().warn({ niche, err: error.message }, "niche_vocabulary show failed");
      return [];
    }

    return (data ?? []) as VocabularyEntry[];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ niche, err: msg }, "niche_vocabulary show threw");
    return [];
  }
}
