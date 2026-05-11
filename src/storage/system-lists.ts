import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";

// ============================================================
// Runtime interfaces — shapes returned to callers after DB load
// ============================================================

export interface RuntimeLists {
  blockedEmailDomains:   ReadonlySet<string>;
  freeEmailDomains:      ReadonlySet<string>;
  blockedEmailPrefixes:  readonly string[];
  stopWords:             ReadonlySet<string>;
  vocabularyStopWords:   ReadonlySet<string>;
  geographicStopWords:   ReadonlySet<string>;
  properNounStopWords:   ReadonlySet<string>;
  socialDomains:         readonly string[];
  platformHosts:         Readonly<Record<string, readonly string[]>>;
  blockedInstagramHosts: readonly string[];
  foreignTlds:           ReadonlySet<string>;
  foreignGeoTerms:       readonly string[];
  foreignPhonePrefixes:  readonly string[];
}

export interface RuntimePatterns {
  booking:         readonly string[];
  reservation:     readonly string[];
  delivery:        readonly string[];
  classBooking:    readonly string[];
  appStore:        readonly { pattern: string; matchType: string }[];
  menuKeywords:    readonly string[];
  catalogKeywords: readonly string[];
  chatWidgets:     readonly string[];
}

export interface RuntimeMappings {
  descriptorWords:     ReadonlyMap<string, string>;
  nicheAliases:        readonly { niche: string; term: string; matchType: string }[];
  directoryCategories: ReadonlyMap<string, string | null>;
  nicheStopWords:      ReadonlyMap<string, ReadonlySet<string>>;
}

export interface AllRuntime {
  lists:    RuntimeLists;
  patterns: RuntimePatterns;
  mappings: RuntimeMappings;
}

// ============================================================
// Fallback values — mirror current hardcoded constants exactly.
// Used when DB is unavailable so the pipeline keeps running.
// ============================================================

function fallbackLists(): RuntimeLists {
  return {
    blockedEmailDomains: new Set([
      "sentry.io", "example.com", "test.com", "wixpress.com", "squarespace.com",
      "shopify.com", "wordpress.com", "googletagmanager.com", "facebook.com",
      "instagram.com", "thinkit.com.uy", "smartserv.com.uy", "hosting.com.uy",
      "hosteruy.com.uy", "uruhost.com.uy", "datamedios.com.uy", "websitio.com.uy",
      "enaming.com",
    ]),
    freeEmailDomains: new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com"]),
    blockedEmailPrefixes: ["noreply", "no-reply", "mailer", "bounce"],
    stopWords: new Set(["de", "del", "la", "las", "el", "los", "y", "e", "the"]),
    vocabularyStopWords: new Set(["center", "centre", "centro"]),
    geographicStopWords: new Set([
      "uruguay", "uruguaya", "uruguayo", "uy", "mvd", "montevideo",
      "salto", "paysandu", "colonia", "rivera", "maldonado", "tacuarembo",
      "melo", "trinidad", "durazno", "fray_bentos", "rocha", "canelones",
      "florida", "san_jose", "mercedes", "minas", "artigas", "young",
      "colon", "cerro_largo", "paso_de_los_toros",
    ]),
    properNounStopWords: new Set([
      "olivera", "vipercar", "carrica", "fiancar", "shoppingcar",
    ]),
    socialDomains: [
      "facebook.com", "instagram.com", "twitter.com", "tiktok.com",
      "linktr.ee", "beacons.ai", "wa.me", "bio.link",
    ],
    platformHosts: {
      facebook:  ["facebook.com", "fb.com"],
      instagram: ["instagram.com", "ig.com"],
    },
    blockedInstagramHosts: ["about.meta.com", "facebook.com", "instagram.com", "meta.com"],
    foreignTlds: new Set(["ar", "br", "cl", "co", "mx", "pe", "py"]),
    foreignGeoTerms: [
      "argentina", "buenos aires", "brasil", "brazil", "chile", "colombia",
      "mexico", "mexico city", "méxico", "paraguay", "peru", "perú",
      "santiago de chile", "sao paulo", "são paulo", "tehuacan", "tehuacán",
    ],
    foreignPhonePrefixes: ["+52", "+54", "+55", "+56", "+57", "+51", "+591", "+595"],
  };
}

function fallbackPatterns(): RuntimePatterns {
  return {
    booking:      ["booksy.com", "fresha.com", "genbook.com", "simplybook.me", "calendly.com"],
    reservation:  ["reservando.uy", "thefork.com", "opentable.com"],
    delivery:     ["pedidosya.com", "rappi.com", "ifood.com", "ifood.com.uy"],
    classBooking: ["mindbody.io", "wodify.com", "classpass.com", "booksy.com"],
    appStore: [
      { pattern: "play.google.com/store/apps", matchType: "substring" },
      { pattern: "apps.apple.com",             matchType: "domain" },
    ],
    menuKeywords:    ["pedidosya", "ifood", "menupiu", "ver carta", "ver menu", "escanear qr"],
    catalogKeywords: ["catálogo", "catalogo", "stock", "0km", "usados", "kilometraje"],
    chatWidgets: [
      "tawk.to", "intercom.io", "widget.intercom.io", "crisp.chat",
      "client.crisp.chat", "tidio.co", "code.tidio.co", "livechat.com",
      "cdn.livechatinc.com", "zendesk.com/embeddable_framework",
      "freshchat.com", "wchat.freshchat.com",
    ],
  };
}

function fallbackMappings(): RuntimeMappings {
  return {
    descriptorWords: new Map([
      ["peluqueria", "pelu"], ["peluquerias", "pelu"],
      ["barberia", "barber"], ["barberias", "barber"],
    ]),
    nicheAliases: [
      { niche: "hairdresser", term: "peluquer",   matchType: "contains" },
      { niche: "hairdresser", term: "barber",     matchType: "contains" },
      { niche: "hairdresser", term: "hair",       matchType: "contains" },
      { niche: "car_dealer",  term: "concesion",  matchType: "contains" },
      { niche: "car_dealer",  term: "automovil",  matchType: "contains" },
      { niche: "car_dealer",  term: "auto",       matchType: "contains" },
      { niche: "car_dealer",  term: "car dealer", matchType: "contains" },
      { niche: "restaurant",  term: "restaurant", matchType: "contains" },
      { niche: "restaurant",  term: "restaurante",matchType: "contains" },
      { niche: "restaurant",  term: "parrilla",   matchType: "contains" },
      { niche: "gym",         term: "gimnasio",   matchType: "contains" },
      { niche: "gym",         term: "gym",        matchType: "contains" },
      { niche: "gym",         term: "fitness",    matchType: "contains" },
      { niche: "healthcare",  term: "clinica",    matchType: "contains" },
      { niche: "healthcare",  term: "medic",      matchType: "contains" },
      { niche: "healthcare",  term: "healthcare", matchType: "contains" },
      { niche: "dentist",     term: "dentista",   matchType: "contains" },
      { niche: "dentist",     term: "odontolog",  matchType: "contains" },
      { niche: "dentist",     term: "dentist",    matchType: "contains" },
    ],
    directoryCategories: new Map([
      ["hairdresser",   "Peluqueros"],
      ["car_dealer",    "Venta_de_Vehículos"],
      ["gym",           "Fitness"],
      ["restaurant",    "Restaurantes"],
      ["accommodation", "Hoteles"],
      ["pharmacy",      null],
      ["grocery",       "Supermercado"],
      ["dentist",       "Dentistas"],
      ["healthcare",    "Médicos_y_Clínicos"],
      ["other",         null],
    ]),
    nicheStopWords: new Map([
      ["all", new Set([
        "center", "centre", "centro", "studio", "estudio", "group", "grupo",
        "servicios", "service", "services", "soluciones", "solutions",
      ])],
      ["car_dealer", new Set([
        "motors", "motor", "autos", "auto", "automovil", "automoviles",
        "vehiculo", "vehiculos", "propios", "concesionaria", "automotora",
        "automotores", "garage", "taller",
      ])],
      ["hairdresser", new Set([
        "coiffeur", "estilista", "peluquero", "peluquera", "peinados",
        "peinado", "barbero", "cortes", "corte",
      ])],
      ["gym", new Set([
        "fitness", "sport", "sports", "training", "crossfit", "spinning",
        "cardio", "musculacion",
      ])],
    ]),
  };
}

// ============================================================
// DB loaders
// ============================================================

type SystemListRow = { list_name: string; value: string; scope: string | null };
type PlatformPatternRow = { platform_type: string; pattern: string; match_type: string };
type NicheMappingRow = {
  niche: string;
  term: string;
  mapping_type: string;
  target_value: string | null;
  match_type: string;
};

export async function loadRuntimeLists(): Promise<RuntimeLists> {
  try {
    const { data, error } = await getSupabase()
      .from("system_lists")
      .select("list_name, value, scope")
      .eq("enabled", true);

    if (error) {
      getLogger().warn({ err: error.message }, "loadRuntimeLists — DB error, using fallback");
      return fallbackLists();
    }

    const rows: SystemListRow[] = data ?? [];

    const byName = (name: string): string[] =>
      rows.filter((r) => r.list_name === name && r.scope === null).map((r) => r.value);

    const byNameScoped = (name: string, scope: string): string[] =>
      rows.filter((r) => r.list_name === name && r.scope === scope).map((r) => r.value);

    const platformScopes = [...new Set(
      rows.filter((r) => r.list_name === "platform_hosts" && r.scope !== null).map((r) => r.scope as string)
    )];
    const platformHosts: Record<string, string[]> = {};
    for (const scope of platformScopes) {
      platformHosts[scope] = byNameScoped("platform_hosts", scope);
    }

    return {
      blockedEmailDomains:   new Set(byName("blocked_email_domains")),
      freeEmailDomains:      new Set(byName("free_email_domains")),
      blockedEmailPrefixes:  byName("blocked_email_prefixes"),
      stopWords:             new Set(byName("stop_words")),
      vocabularyStopWords:   new Set(byName("vocabulary_stop_words")),
      geographicStopWords:   new Set(byName("geographic_stop_words")),
      properNounStopWords:   new Set(byName("proper_noun_stop_words")),
      socialDomains:         byName("social_domains"),
      platformHosts,
      blockedInstagramHosts: byName("blocked_instagram_hosts"),
      foreignTlds:           new Set(byName("foreign_tlds")),
      foreignGeoTerms:       byName("foreign_geo_terms"),
      foreignPhonePrefixes:  byName("foreign_phone_prefixes"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ err: msg }, "loadRuntimeLists — threw, using fallback");
    return fallbackLists();
  }
}

export async function loadRuntimePatterns(): Promise<RuntimePatterns> {
  try {
    const { data, error } = await getSupabase()
      .from("platform_patterns")
      .select("platform_type, pattern, match_type")
      .eq("enabled", true);

    if (error) {
      getLogger().warn({ err: error.message }, "loadRuntimePatterns — DB error, using fallback");
      return fallbackPatterns();
    }

    const rows: PlatformPatternRow[] = data ?? [];

    const domainPatterns = (type: string): string[] =>
      rows.filter((r) => r.platform_type === type && r.match_type === "domain").map((r) => r.pattern);

    const allPatterns = (type: string): { pattern: string; matchType: string }[] =>
      rows.filter((r) => r.platform_type === type).map((r) => ({ pattern: r.pattern, matchType: r.match_type }));

    const keywordPatterns = (type: string): string[] =>
      rows.filter((r) => r.platform_type === type && r.match_type === "keyword").map((r) => r.pattern);

    const substringPatterns = (type: string): string[] =>
      rows.filter((r) => r.platform_type === type && r.match_type === "substring").map((r) => r.pattern);

    return {
      booking:         domainPatterns("booking"),
      reservation:     domainPatterns("reservation"),
      delivery:        domainPatterns("delivery"),
      classBooking:    domainPatterns("class_booking"),
      appStore:        allPatterns("app_store"),
      menuKeywords:    keywordPatterns("menu_keyword"),
      catalogKeywords: keywordPatterns("catalog_keyword"),
      chatWidgets:     substringPatterns("chat_widget"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ err: msg }, "loadRuntimePatterns — threw, using fallback");
    return fallbackPatterns();
  }
}

export async function loadRuntimeMappings(): Promise<RuntimeMappings> {
  try {
    const { data, error } = await getSupabase()
      .from("niche_mappings")
      .select("niche, term, mapping_type, target_value, match_type")
      .eq("enabled", true);

    if (error) {
      getLogger().warn({ err: error.message }, "loadRuntimeMappings — DB error, using fallback");
      return fallbackMappings();
    }

    const rows: NicheMappingRow[] = data ?? [];

    const descriptorWords = new Map<string, string>();
    const nicheAliases: { niche: string; term: string; matchType: string }[] = [];
    const directoryCategories = new Map<string, string | null>();
    const nicheStopWords = new Map<string, Set<string>>();

    for (const row of rows) {
      switch (row.mapping_type) {
        case "descriptor_word":
          if (row.target_value !== null) {
            descriptorWords.set(row.term, row.target_value);
          }
          break;

        case "niche_alias":
          nicheAliases.push({ niche: row.niche, term: row.term, matchType: row.match_type });
          break;

        case "directory_category":
          directoryCategories.set(row.niche, row.target_value ?? null);
          break;

        case "niche_stop_word": {
          const existing = nicheStopWords.get(row.niche);
          if (existing) {
            existing.add(row.term);
          } else {
            nicheStopWords.set(row.niche, new Set([row.term]));
          }
          break;
        }
      }
    }

    return { descriptorWords, nicheAliases, directoryCategories, nicheStopWords };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ err: msg }, "loadRuntimeMappings — threw, using fallback");
    return fallbackMappings();
  }
}

export async function loadAllRuntime(): Promise<AllRuntime> {
  const [lists, patterns, mappings] = await Promise.all([
    loadRuntimeLists(),
    loadRuntimePatterns(),
    loadRuntimeMappings(),
  ]);
  return { lists, patterns, mappings };
}

// ============================================================
// Auto-detection: email provider domains
// Runs after an enrich batch to surface repeated domains across leads.
// Inserts with source='auto_detected'; never overwrites seeds.
// ============================================================

export async function detectAndSeedEmailProviders(minLeadCount = 2): Promise<number> {
  const db = getSupabase();

  // Supabase JS client does not expose raw SQL easily; use rpc for this aggregate query.
  // The function `detect_email_provider_domains` must exist in the DB (future migration).
  // For now, fall back gracefully if it doesn't.
  try {
    const { data, error } = await db.rpc("detect_email_provider_domains", { min_lead_count: minLeadCount });

    if (error) {
      getLogger().warn({ err: error.message }, "detectAndSeedEmailProviders — rpc failed, skipping");
      return 0;
    }

    const domains: string[] = (data ?? []).map((r: { domain: string }) => r.domain);
    if (domains.length === 0) return 0;

    const rows = domains.map((domain) => ({
      list_name:  "blocked_email_domains",
      value:      domain,
      scope:      null as string | null,
      source:     "auto_detected" as const,
      confidence: Math.min(minLeadCount / 10, 1.0),
      reason:     "auto-detected email provider domain",
    }));

    const { error: upsertError } = await db
      .from("system_lists")
      .upsert(rows, { onConflict: "list_name,value,COALESCE(scope,'')", ignoreDuplicates: true });

    if (upsertError) {
      getLogger().warn({ err: upsertError.message }, "detectAndSeedEmailProviders — upsert failed");
      return 0;
    }

    getLogger().info({ count: rows.length }, "detectAndSeedEmailProviders — inserted new domains");
    return rows.length;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ err: msg }, "detectAndSeedEmailProviders — threw, skipping");
    return 0;
  }
}
