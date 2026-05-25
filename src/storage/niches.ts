import { getSupabase } from "../shared/supabase.js";

export type NicheAliasGroup = {
  id: string;
  canonical: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
};

export async function listNicheAliasGroups(): Promise<NicheAliasGroup[]> {
  const { data, error } = await getSupabase()
    .from("niche_aliases")
    .select("id, canonical, aliases, created_at, updated_at")
    .order("canonical");
  if (error) throw new Error(`Failed to list niche alias groups: ${error.message}`);
  return (data ?? []) as NicheAliasGroup[];
}

export async function createNicheAliasGroup(
  canonical: string,
  aliases: string[]
): Promise<NicheAliasGroup> {
  const { data, error } = await getSupabase()
    .from("niche_aliases")
    .insert({ canonical, aliases })
    .select()
    .single();
  if (error) throw new Error(`Failed to create niche alias group: ${error.message}`);
  return data as NicheAliasGroup;
}

export async function updateNicheAliasGroup(
  id: string,
  canonical: string,
  aliases: string[]
): Promise<NicheAliasGroup> {
  const { data, error } = await getSupabase()
    .from("niche_aliases")
    .update({ canonical, aliases, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update niche alias group: ${error.message}`);
  return data as NicheAliasGroup;
}

export async function deleteNicheAliasGroup(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("niche_aliases")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`Failed to delete niche alias group: ${error.message}`);
}

/**
 * Returns all niche values equivalent to the given niche (including itself).
 * Loads all groups in memory — the table is small (<100 rows) by design.
 * Returns [niche] if the niche isn't in any alias group.
 */
export async function expandNiche(niche: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("niche_aliases")
    .select("canonical, aliases");
  if (error) throw new Error(`Failed to expand niche aliases: ${error.message}`);

  const groups = (data ?? []) as { canonical: string; aliases: string[] }[];
  const match = groups.find(
    (g) => g.canonical === niche || g.aliases.includes(niche)
  );
  if (!match) return [niche];

  const all = new Set<string>([match.canonical, ...match.aliases]);
  return Array.from(all);
}
