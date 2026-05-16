import { getSupabase } from "../shared/supabase.js";
import { getLogger } from "../shared/logger.js";

// ============================================================
// Runtime interfaces — shapes returned to callers after DB load
// ============================================================

export interface RuntimeLists {
  blockedEmailDomains:    ReadonlySet<string>;
  blockedHeuristicDomains: ReadonlySet<string>;
  freeEmailDomains:       ReadonlySet<string>;
  blockedEmailPrefixes:   readonly string[];
  stopWords:              ReadonlySet<string>;
  vocabularyStopWords:    ReadonlySet<string>;
  geographicStopWords:    ReadonlySet<string>;
  properNounStopWords:    ReadonlySet<string>;
  socialDomains:          readonly string[];
  platformHosts:          Readonly<Record<string, readonly string[]>>;
  blockedInstagramHosts:  readonly string[];
  foreignTlds:            ReadonlySet<string>;
  foreignEmailTlds:       ReadonlySet<string>;
  foreignGeoTerms:        readonly string[];
  foreignPhonePrefixes:   readonly string[];
  franchiseNames:         ReadonlySet<string>;
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
  reservationPlatforms:  readonly string[];
  deliveryPlatforms:     readonly string[];
  classBookingPlatforms: readonly string[];
  appStorePlatforms:     readonly { pattern: string; matchType: string }[];
  chatWidgetPatterns:    readonly string[];
  ecommercePlatforms:    readonly string[];
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
    blockedHeuristicDomains: new Set(),
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
    foreignEmailTlds: new Set([
      "ar", "br", "cl", "co", "mx", "pe", "py",
      "co.uk", "com.br", "com.ar", "com.mx", "com.co",
      "com.pe", "com.py",
    ]),
    foreignGeoTerms: [
      "argentina", "buenos aires", "brasil", "brazil", "chile", "colombia",
      "mexico", "mexico city", "méxico", "paraguay", "peru", "perú",
      "santiago de chile", "sao paulo", "são paulo", "tehuacan", "tehuacán",
    ],
    foreignPhonePrefixes: ["+52", "+54", "+55", "+56", "+57", "+51", "+591", "+595"],
    franchiseNames: new Set([
      "Abitab", "Redpagos", "Hertz Rent A Car", "McDonald's", "Subway",
      "KFC", "Burger King", "Starbucks", "Pizza Hut", "Farmashop", "Farmacenter",
      "Tienda Inglesa", "Devoto", "Disco", "Ta-Ta", "Ancap", "Antel", "UTE", "OSE",
      "Pronto!", "OCA", "Creditel", "COT", "Cometa", "El Rápido", "COPSA",
      "Cinépolis", "Cinemark", "Macro Mercado", "Multiahorro",
    ]),
  };
}

function fallbackPatterns(): RuntimePatterns {
  const booking = ["booksy.com", "fresha.com", "genbook.com", "simplybook.me", "calendly.com"];
  const reservation = ["reservando.uy", "thefork.com", "opentable.com"];
  const delivery = ["pedidosya.com", "rappi.com", "ifood.com", "ifood.com.uy"];
  const classBooking = ["mindbody.io", "wodify.com", "classpass.com", "booksy.com"];
  const appStore = [
    { pattern: "play.google.com/store/apps", matchType: "substring" },
    { pattern: "apps.apple.com", matchType: "domain" },
  ];
  const menuKeywords = ["pedidosya", "ifood", "menupiu", "ver carta", "ver menu", "escanear qr"];
  const catalogKeywords = ["catálogo", "catalogo", "stock", "0km", "usados", "kilometraje"];
  const chatWidgets = [
    "tawk.to", "intercom.io", "widget.intercom.io", "crisp.chat",
    "client.crisp.chat", "tidio.co", "code.tidio.co", "livechat.com",
    "cdn.livechatinc.com", "zendesk.com/embeddable_framework",
    "freshchat.com", "wchat.freshchat.com",
  ];
  const ecommerce = [
    "mercadopago.com/integrations",
    "js.stripe.com",
    "paypal.com/sdk",
    "cdn.shopify.com",
    "wp-content/plugins/woocommerce",
    "d3ugyf5w97bob5.cloudfront.net",
  ];

  return {
    booking,
    reservation,
    delivery,
    classBooking,
    appStore,
    menuKeywords,
    catalogKeywords,
    chatWidgets,
    reservationPlatforms: reservation,
    deliveryPlatforms: delivery,
    classBookingPlatforms: classBooking,
    appStorePlatforms: appStore,
    chatWidgetPatterns: chatWidgets,
    ecommercePlatforms: ecommerce,
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

function extractApexDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = hostname.split(".");
    const ccTld = parts.at(-1);
    const secondLevel = parts.at(-2);
    const registrable = parts.at(-3);
    if (
      parts.length >= 3 &&
      ccTld?.length === 2 &&
      secondLevel !== undefined &&
      registrable !== undefined
    ) {
      if (["com", "net", "org", "edu", "gub", "mil"].includes(secondLevel)) {
        return `${registrable}.${ccTld}`;
      }
      return `${registrable}.${secondLevel}.${ccTld}`;
    }
    return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch {
    return null;
  }
}

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
      blockedEmailDomains:    new Set(byName("blocked_email_domains")),
      blockedHeuristicDomains: new Set(byName("blocked_heuristic_domains")),
      freeEmailDomains:       new Set(byName("free_email_domains")),
      blockedEmailPrefixes:   byName("blocked_email_prefixes"),
      stopWords:              new Set(byName("stop_words")),
      vocabularyStopWords:    new Set(byName("vocabulary_stop_words")),
      geographicStopWords:    new Set(byName("geographic_stop_words")),
      properNounStopWords:    new Set(byName("proper_noun_stop_words")),
      socialDomains:          byName("social_domains"),
      platformHosts,
      blockedInstagramHosts:  byName("blocked_instagram_hosts"),
      foreignTlds:            new Set(byName("foreign_tlds")),
      foreignEmailTlds:       new Set(byName("foreign_tlds")),
      foreignGeoTerms:        byName("foreign_geo_terms"),
      foreignPhonePrefixes:   byName("foreign_phone_prefixes"),
      franchiseNames: (() => {
        const raw = byName("franchise_names");
        return raw.length > 0 ? new Set(raw) : fallbackLists().franchiseNames;
      })(),
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

    const booking = domainPatterns("booking");
    const reservation = domainPatterns("reservation");
    const delivery = domainPatterns("delivery");
    const classBooking = domainPatterns("class_booking");
    const appStore = allPatterns("app_store");
    const menuKeywords = keywordPatterns("menu_keyword");
    const catalogKeywords = keywordPatterns("catalog_keyword");
    const chatWidgets = substringPatterns("chat_widget");
    const ecommerce = substringPatterns("ecommerce");

    return {
      booking,
      reservation,
      delivery,
      classBooking,
      appStore,
      menuKeywords,
      catalogKeywords,
      chatWidgets,
      reservationPlatforms: reservation,
      deliveryPlatforms: delivery,
      classBookingPlatforms: classBooking,
      appStorePlatforms: appStore,
      chatWidgetPatterns: chatWidgets,
      ecommercePlatforms: ecommerce.length > 0 ? ecommerce : fallbackPatterns().ecommercePlatforms,
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

  try {
    const { data, error } = await db
      .from("leads")
      .select("id, emails:digital_footprint->contact_emails")
      .eq("passed_filter", true)
      .not("digital_footprint->contact_emails", "is", null);

    if (error) {
      getLogger().warn({ err: error.message }, "detectAndSeedEmailProviders — lead query failed, skipping");
      return 0;
    }

    const leadCounts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ id: string; emails: unknown }>) {
      if (!Array.isArray(row.emails)) continue;

      const domainsForLead = new Set<string>();
      for (const email of row.emails) {
        const domain = extractEmailDomain(email);
        if (domain) domainsForLead.add(domain);
      }

      for (const domain of domainsForLead) {
        leadCounts.set(domain, (leadCounts.get(domain) ?? 0) + 1);
      }
    }

    const candidateDomains = [...leadCounts.entries()]
      .filter(([, leadCount]) => leadCount >= minLeadCount);

    if (candidateDomains.length === 0) return 0;

    const { data: existingRows, error: existingError } = await db
      .from("system_lists")
      .select("value")
      .eq("list_name", "blocked_email_domains");

    if (existingError) {
      getLogger().warn({ err: existingError.message }, "detectAndSeedEmailProviders — existing domain query failed, skipping");
      return 0;
    }

    const existingDomains = new Set((existingRows ?? []).map((row: { value: string }) => row.value.toLowerCase()));
    const rows = candidateDomains
      .filter(([domain]) => !existingDomains.has(domain))
      .map(([domain, leadCount]) => ({
      list_name:  "blocked_email_domains",
      value:      domain,
      scope:      null as string | null,
      source:     "auto_detected" as const,
      confidence: Math.min(leadCount / 10, 1.0),
      reason:     "auto-detected email provider domain",
    }));

    if (rows.length === 0) return 0;

    const { error: insertError } = await db
      .from("system_lists")
      .insert(rows);

    if (insertError) {
      getLogger().warn({ err: insertError.message }, "detectAndSeedEmailProviders — insert failed");
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

// ============================================================
// Retroactive email cleanup
// After new blocked_email_domains are seeded, fix leads that
// already hold emails from those domains. Idempotent.
// ============================================================

export async function retroactiveEmailCleanup(): Promise<number> {
  const db  = getSupabase();
  const log = getLogger();

  try {
    const { data: listRows, error: listError } = await db
      .from("system_lists")
      .select("list_name, value")
      .in("list_name", ["blocked_email_domains", "free_email_domains"])
      .eq("enabled", true);

    if (listError) {
      log.warn({ err: listError.message }, "retroactiveEmailCleanup — domain list query failed, skipping");
      return 0;
    }

    const blockedDomains = new Set<string>();
    const freeDomains    = new Set<string>();
    for (const row of (listRows ?? []) as Array<{ list_name: string; value: string }>) {
      if (row.list_name === "blocked_email_domains") blockedDomains.add(row.value.toLowerCase());
      else if (row.list_name === "free_email_domains") freeDomains.add(row.value.toLowerCase());
    }

    // Free-email domains (gmail, hotmail…) belong to the business owner — never clean them
    const domainsToClean = new Set([...blockedDomains].filter(d => !freeDomains.has(d)));
    if (domainsToClean.size === 0) return 0;

    const { data: leads, error: leadsError } = await db
      .from("leads")
      .select("id, tags, digital_footprint")
      .eq("passed_filter", true)
      .not("digital_footprint->contact_emails", "is", null);

    if (leadsError) {
      log.warn({ err: leadsError.message }, "retroactiveEmailCleanup — leads query failed, skipping");
      return 0;
    }

    let affected = 0;

    for (const lead of (leads ?? []) as Array<{ id: string; tags: string[]; digital_footprint: Record<string, unknown> | null }>) {
      const fp = lead.digital_footprint;
      if (!fp) continue;

      const contactEmails = fp["contact_emails"];
      if (!Array.isArray(contactEmails) || contactEmails.length === 0) continue;

      const filteredEmails = (contactEmails as string[]).filter(e => {
        const domain = extractEmailDomain(e);
        return domain === null || !domainsToClean.has(domain);
      });

      if (filteredEmails.length === contactEmails.length) continue;

      const updatedFp = { ...fp, contact_emails: filteredEmails };
      const tagSet    = new Set(lead.tags ?? []);

      if (filteredEmails.length === 0) {
        tagSet.delete("email-found");
        tagSet.add("email-missing");
      } else {
        tagSet.delete("email-missing");
      }

      const { error: updateError } = await db
        .from("leads")
        .update({ digital_footprint: updatedFp, tags: [...tagSet] })
        .eq("id", lead.id);

      if (updateError) {
        log.warn({ err: updateError.message, leadId: lead.id }, "retroactiveEmailCleanup — update failed for lead");
        continue;
      }

      affected++;
    }

    if (affected > 0) {
      log.info({ count: affected }, "retroactiveEmailCleanup — leads updated");
    }
    return affected;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, "retroactiveEmailCleanup — threw, skipping");
    return 0;
  }
}

export async function detectAndSeedHeuristicDomains(minLeadCount = 2): Promise<number> {
  const db = getSupabase();

  try {
    const { data, error } = await db
      .from("leads")
      .select("id, heuristic_url:digital_footprint->heuristic_discovery->selected->website->>url")
      .eq("passed_filter", true)
      .not("digital_footprint->heuristic_discovery->selected->website->>url", "is", null);

    if (error) {
      getLogger().warn({ err: error.message }, "detectAndSeedHeuristicDomains — lead query failed, skipping");
      return 0;
    }

    const leadCounts = new Map<string, Set<string>>();
    for (const row of (data ?? []) as Array<{ id: string; heuristic_url: unknown }>) {
      const domain = typeof row.heuristic_url === "string"
        ? extractApexDomain(row.heuristic_url)
        : null;
      if (!domain) continue;

      const ids = leadCounts.get(domain) ?? new Set<string>();
      ids.add(row.id);
      leadCounts.set(domain, ids);
    }

    const candidateDomains = [...leadCounts.entries()]
      .map(([domain, ids]) => [domain, ids.size] as const)
      .filter(([, leadCount]) => leadCount >= minLeadCount);

    if (candidateDomains.length === 0) return 0;

    const { data: existingRows, error: existingError } = await db
      .from("system_lists")
      .select("value")
      .eq("list_name", "blocked_heuristic_domains");

    if (existingError) {
      getLogger().warn({ err: existingError.message }, "detectAndSeedHeuristicDomains — existing domain query failed, skipping");
      return 0;
    }

    const existingDomains = new Set((existingRows ?? []).map((row: { value: string }) => row.value.toLowerCase()));
    const rows = candidateDomains
      .filter(([domain]) => !existingDomains.has(domain))
      .map(([domain, leadCount]) => ({
        list_name: "blocked_heuristic_domains",
        value: domain,
        scope: null as string | null,
        source: "auto_detected" as const,
        confidence: Math.min(leadCount / 10, 1.0),
        reason: "auto-detected shared heuristic domain",
      }));

    if (rows.length === 0) return 0;

    const { error: insertError } = await db
      .from("system_lists")
      .insert(rows);

    if (insertError) {
      getLogger().warn({ err: insertError.message }, "detectAndSeedHeuristicDomains — insert failed");
      return 0;
    }

    getLogger().info({ count: rows.length }, "detectAndSeedHeuristicDomains — inserted new domains");
    return rows.length;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ err: msg }, "detectAndSeedHeuristicDomains — threw, skipping");
    return 0;
  }
}

/*
  Seed inicial para franchise_names — ejecutar una vez en la DB:

  INSERT INTO system_lists (list_name, value, scope, source, confidence, reason, enabled) VALUES
    ('franchise_names', 'Abitab', NULL, 'seed', 1.0, 'cadena financiera UY', true),
    ('franchise_names', 'Redpagos', NULL, 'seed', 1.0, 'cadena financiera UY', true),
    ('franchise_names', 'Hertz Rent A Car', NULL, 'seed', 1.0, 'rentadora internacional', true),
    ('franchise_names', 'McDonald''s', NULL, 'seed', 1.0, 'cadena fast food', true),
    ('franchise_names', 'Subway', NULL, 'seed', 1.0, 'cadena fast food', true),
    ('franchise_names', 'KFC', NULL, 'seed', 1.0, 'cadena fast food', true),
    ('franchise_names', 'Burger King', NULL, 'seed', 1.0, 'cadena fast food', true),
    ('franchise_names', 'Starbucks', NULL, 'seed', 1.0, 'cadena café', true),
    ('franchise_names', 'Farmashop', NULL, 'seed', 1.0, 'cadena farmacia UY', true),
    ('franchise_names', 'Farmacenter', NULL, 'seed', 1.0, 'cadena farmacia UY', true),
    ('franchise_names', 'Tienda Inglesa', NULL, 'seed', 1.0, 'supermercado UY', true),
    ('franchise_names', 'Devoto', NULL, 'seed', 1.0, 'supermercado UY', true),
    ('franchise_names', 'Disco', NULL, 'seed', 1.0, 'supermercado UY', true),
    ('franchise_names', 'Ta-Ta', NULL, 'seed', 1.0, 'supermercado UY', true),
    ('franchise_names', 'Ancap', NULL, 'seed', 1.0, 'estación de servicio estatal UY', true),
    ('franchise_names', 'Pronto!', NULL, 'seed', 1.0, 'cadena financiera UY', true),
    ('franchise_names', 'OCA', NULL, 'seed', 1.0, 'cadena financiera UY', true),
    ('franchise_names', 'Creditel', NULL, 'seed', 1.0, 'cadena financiera UY', true),
    ('franchise_names', 'COT', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
    ('franchise_names', 'Cometa', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
    ('franchise_names', 'El Rápido', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
    ('franchise_names', 'COPSA', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
    ('franchise_names', 'Multiahorro', NULL, 'seed', 1.0, 'supermercado UY', true),
    ('franchise_names', 'Macro Mercado', NULL, 'seed', 1.0, 'supermercado UY', true)
  ON CONFLICT DO NOTHING;
*/

function extractEmailDomain(email: unknown): string | null {
  if (typeof email !== "string") return null;

  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;

  return trimmed.slice(atIndex + 1);
}
