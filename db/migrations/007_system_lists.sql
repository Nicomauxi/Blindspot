-- Migration 007: system_lists, platform_patterns, niche_mappings
-- Migrates hardcoded lists/constants from TS source files to DB-backed tables.
-- Pattern follows migration 006 (niche_vocabulary).

-- ============================================================
-- TABLE: system_lists
-- Stores generic key/value lists (blocked domains, stop words, TLDs, etc.)
-- scope=NULL means "global — applies to all niches".
-- ============================================================

CREATE TABLE IF NOT EXISTS system_lists (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_name     text        NOT NULL,
  value         text        NOT NULL,
  scope         text,
  reason        text,
  source        text        NOT NULL
                            CHECK (source IN ('seed', 'auto_detected', 'manual')),
  confidence    numeric(3,2),
  enabled       boolean     NOT NULL DEFAULT true,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at  timestamptz DEFAULT now()
);

-- Functional unique index: treats scope=NULL as '' so two NULL-scope rows with the
-- same list_name+value are considered duplicates (standard UNIQUE ignores NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS system_lists_list_name_value_scope_uniq
  ON system_lists (list_name, value, COALESCE(scope, ''));

CREATE INDEX IF NOT EXISTS system_lists_list_name_idx
  ON system_lists (list_name) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS system_lists_name_scope_idx
  ON system_lists (list_name, scope) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS system_lists_auto_idx
  ON system_lists (list_name, source) WHERE source = 'auto_detected';

-- ============================================================
-- TABLE: platform_patterns
-- Stores URL/keyword patterns used to detect operational platforms
-- (booking, delivery, chat widgets, app stores, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_patterns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_type text        NOT NULL,
  pattern       text        NOT NULL,
  match_type    text        NOT NULL
                            CHECK (match_type IN ('domain', 'keyword', 'substring', 'regex')),
  flags         text,
  niche         text,
  enabled       boolean     NOT NULL DEFAULT true,
  source        text        NOT NULL DEFAULT 'seed',
  created_at    timestamptz DEFAULT now(),
  UNIQUE (platform_type, pattern)
);

CREATE INDEX IF NOT EXISTS platform_patterns_type_idx
  ON platform_patterns (platform_type) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS platform_patterns_niche_idx
  ON platform_patterns (platform_type, niche) WHERE enabled = true;

-- ============================================================
-- TABLE: niche_mappings
-- Stores niche-specific aliases, descriptor words, directory categories,
-- and niche-scoped stop words.
-- niche='all' means the mapping applies to every niche.
-- ============================================================

CREATE TABLE IF NOT EXISTS niche_mappings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  niche         text        NOT NULL,
  term          text        NOT NULL,
  mapping_type  text        NOT NULL
                            CHECK (mapping_type IN (
                              'niche_alias', 'descriptor_word',
                              'directory_category', 'niche_stop_word'
                            )),
  target_value  text,
  match_type    text        NOT NULL DEFAULT 'contains'
                            CHECK (match_type IN ('contains', 'exact', 'prefix', 'suffix')),
  source_system text,
  language      text        DEFAULT 'es',
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (niche, term, mapping_type)
);

CREATE INDEX IF NOT EXISTS niche_mappings_type_idx
  ON niche_mappings (mapping_type) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS niche_mappings_niche_idx
  ON niche_mappings (niche, mapping_type) WHERE enabled = true;

-- ============================================================
-- SEED: system_lists
-- ============================================================

INSERT INTO system_lists (list_name, value, scope, source, reason) VALUES

-- blocked_email_domains
-- (email.ts BLOCKED_DOMAINS + leads.ts DUPLICATE_BLOCKED_EMAIL_DOMAINS — unified)
('blocked_email_domains', 'sentry.io',            NULL, 'seed', 'error tracking service'),
('blocked_email_domains', 'example.com',          NULL, 'seed', 'test domain'),
('blocked_email_domains', 'test.com',             NULL, 'seed', 'test domain'),
('blocked_email_domains', 'wixpress.com',         NULL, 'seed', 'website builder platform'),
('blocked_email_domains', 'squarespace.com',      NULL, 'seed', 'website builder platform'),
('blocked_email_domains', 'shopify.com',          NULL, 'seed', 'e-commerce platform'),
('blocked_email_domains', 'wordpress.com',        NULL, 'seed', 'blogging platform'),
('blocked_email_domains', 'googletagmanager.com', NULL, 'seed', 'analytics tracking service'),
('blocked_email_domains', 'facebook.com',         NULL, 'seed', 'social media platform'),
('blocked_email_domains', 'instagram.com',        NULL, 'seed', 'social media platform'),
('blocked_email_domains', 'thinkit.com.uy',       NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'smartserv.com.uy',     NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'hosting.com.uy',       NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'hosteruy.com.uy',      NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'uruhost.com.uy',       NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'datamedios.com.uy',    NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'websitio.com.uy',      NULL, 'seed', 'UY hosting provider'),
('blocked_email_domains', 'enaming.com',          NULL, 'seed', 'UY hosting/domain registrar'),

-- free_email_domains (email.ts FREE_EMAIL_DOMAINS)
('free_email_domains', 'gmail.com',   NULL, 'seed', 'free email provider'),
('free_email_domains', 'hotmail.com', NULL, 'seed', 'free email provider'),
('free_email_domains', 'outlook.com', NULL, 'seed', 'free email provider'),
('free_email_domains', 'yahoo.com',   NULL, 'seed', 'free email provider'),

-- blocked_email_prefixes (email.ts BLOCKED_PREFIXES)
('blocked_email_prefixes', 'noreply',  NULL, 'seed', 'automated sender'),
('blocked_email_prefixes', 'no-reply', NULL, 'seed', 'automated sender'),
('blocked_email_prefixes', 'mailer',   NULL, 'seed', 'automated sender'),
('blocked_email_prefixes', 'bounce',   NULL, 'seed', 'bounce handler'),

-- stop_words (heuristic-discovery.ts STOP_WORDS)
('stop_words', 'de',  NULL, 'seed', 'Spanish preposition'),
('stop_words', 'del', NULL, 'seed', 'Spanish preposition'),
('stop_words', 'la',  NULL, 'seed', 'Spanish article'),
('stop_words', 'las', NULL, 'seed', 'Spanish article'),
('stop_words', 'el',  NULL, 'seed', 'Spanish article'),
('stop_words', 'los', NULL, 'seed', 'Spanish article'),
('stop_words', 'y',   NULL, 'seed', 'Spanish conjunction'),
('stop_words', 'e',   NULL, 'seed', 'Spanish conjunction'),
('stop_words', 'the', NULL, 'seed', 'English article'),

-- vocabulary_stop_words (vocabulary.ts niche_vocabulary universal seeds — overlap)
('vocabulary_stop_words', 'center',  NULL, 'seed', 'generic business descriptor'),
('vocabulary_stop_words', 'centre',  NULL, 'seed', 'generic business descriptor'),
('vocabulary_stop_words', 'centro',  NULL, 'seed', 'generic business descriptor'),

-- geographic_stop_words (enrichment.yaml heuristic_discovery.geographic_stop_words)
('geographic_stop_words', 'uruguay',           NULL, 'seed', 'UY country name'),
('geographic_stop_words', 'uruguaya',          NULL, 'seed', 'UY demonym'),
('geographic_stop_words', 'uruguayo',          NULL, 'seed', 'UY demonym'),
('geographic_stop_words', 'uy',                NULL, 'seed', 'UY country code'),
('geographic_stop_words', 'mvd',               NULL, 'seed', 'Montevideo abbreviation'),
('geographic_stop_words', 'montevideo',        NULL, 'seed', 'UY capital city'),
('geographic_stop_words', 'salto',             NULL, 'seed', 'UY department'),
('geographic_stop_words', 'paysandu',          NULL, 'seed', 'UY department'),
('geographic_stop_words', 'colonia',           NULL, 'seed', 'UY department'),
('geographic_stop_words', 'rivera',            NULL, 'seed', 'UY department'),
('geographic_stop_words', 'maldonado',         NULL, 'seed', 'UY department'),
('geographic_stop_words', 'tacuarembo',        NULL, 'seed', 'UY department'),
('geographic_stop_words', 'melo',              NULL, 'seed', 'UY city'),
('geographic_stop_words', 'trinidad',          NULL, 'seed', 'UY city'),
('geographic_stop_words', 'durazno',           NULL, 'seed', 'UY department'),
('geographic_stop_words', 'fray_bentos',       NULL, 'seed', 'UY city'),
('geographic_stop_words', 'rocha',             NULL, 'seed', 'UY department'),
('geographic_stop_words', 'canelones',         NULL, 'seed', 'UY department'),
('geographic_stop_words', 'florida',           NULL, 'seed', 'UY department'),
('geographic_stop_words', 'san_jose',          NULL, 'seed', 'UY department'),
('geographic_stop_words', 'mercedes',          NULL, 'seed', 'UY city'),
('geographic_stop_words', 'minas',             NULL, 'seed', 'UY city'),
('geographic_stop_words', 'artigas',           NULL, 'seed', 'UY department'),
('geographic_stop_words', 'young',             NULL, 'seed', 'UY city'),
('geographic_stop_words', 'colon',             NULL, 'seed', 'UY city'),
('geographic_stop_words', 'cerro_largo',       NULL, 'seed', 'UY department'),
('geographic_stop_words', 'paso_de_los_toros', NULL, 'seed', 'UY city'),

-- proper_noun_stop_words (enrichment.yaml heuristic_discovery.proper_noun_stop_words)
('proper_noun_stop_words', 'olivera',     NULL, 'seed', 'auto-detected proper noun — generic brand'),
('proper_noun_stop_words', 'vipercar',    NULL, 'seed', 'auto-detected proper noun — generic brand'),
('proper_noun_stop_words', 'carrica',     NULL, 'seed', 'auto-detected proper noun — generic brand'),
('proper_noun_stop_words', 'fiancar',     NULL, 'seed', 'auto-detected proper noun — generic brand'),
('proper_noun_stop_words', 'shoppingcar', NULL, 'seed', 'auto-detected proper noun — generic brand'),

-- social_domains (used in discovery to skip non-website URLs)
('social_domains', 'facebook.com',  NULL, 'seed', 'social media platform'),
('social_domains', 'instagram.com', NULL, 'seed', 'social media platform'),
('social_domains', 'twitter.com',   NULL, 'seed', 'social media platform'),
('social_domains', 'tiktok.com',    NULL, 'seed', 'social media platform'),
('social_domains', 'linktr.ee',     NULL, 'seed', 'link aggregator'),
('social_domains', 'beacons.ai',    NULL, 'seed', 'link aggregator'),
('social_domains', 'wa.me',         NULL, 'seed', 'WhatsApp short link'),
('social_domains', 'bio.link',      NULL, 'seed', 'link aggregator'),

-- platform_hosts — facebook (social-search.ts PLATFORM_HOSTS.facebook)
('platform_hosts', 'facebook.com', 'facebook', 'seed', 'main Facebook domain'),
('platform_hosts', 'fb.com',       'facebook', 'seed', 'Facebook short domain'),

-- platform_hosts — instagram (social-search.ts PLATFORM_HOSTS.instagram)
('platform_hosts', 'instagram.com', 'instagram', 'seed', 'main Instagram domain'),
('platform_hosts', 'ig.com',        'instagram', 'seed', 'Instagram short domain'),

-- blocked_instagram_hosts (instagram.ts local blockedHosts)
('blocked_instagram_hosts', 'about.meta.com', NULL, 'seed', 'Meta corporate site'),
('blocked_instagram_hosts', 'facebook.com',   NULL, 'seed', 'parent company site'),
('blocked_instagram_hosts', 'instagram.com',  NULL, 'seed', 'self-reference'),
('blocked_instagram_hosts', 'meta.com',        NULL, 'seed', 'Meta corporate site'),

-- foreign_tlds (geo-penalty.ts FOREIGN_TLDS)
('foreign_tlds', 'ar', NULL, 'seed', 'Argentina TLD'),
('foreign_tlds', 'br', NULL, 'seed', 'Brazil TLD'),
('foreign_tlds', 'cl', NULL, 'seed', 'Chile TLD'),
('foreign_tlds', 'co', NULL, 'seed', 'Colombia TLD'),
('foreign_tlds', 'mx', NULL, 'seed', 'Mexico TLD'),
('foreign_tlds', 'pe', NULL, 'seed', 'Peru TLD'),
('foreign_tlds', 'py', NULL, 'seed', 'Paraguay TLD'),

-- foreign_geo_terms (geo-penalty.ts FOREIGN_GEO_TERMS)
('foreign_geo_terms', 'argentina',         NULL, 'seed', 'foreign country name'),
('foreign_geo_terms', 'buenos aires',      NULL, 'seed', 'foreign city'),
('foreign_geo_terms', 'brasil',            NULL, 'seed', 'foreign country name ES'),
('foreign_geo_terms', 'brazil',            NULL, 'seed', 'foreign country name EN'),
('foreign_geo_terms', 'chile',             NULL, 'seed', 'foreign country name'),
('foreign_geo_terms', 'colombia',          NULL, 'seed', 'foreign country name'),
('foreign_geo_terms', 'mexico',            NULL, 'seed', 'foreign country name ES'),
('foreign_geo_terms', 'mexico city',       NULL, 'seed', 'foreign city'),
('foreign_geo_terms', 'méxico',            NULL, 'seed', 'foreign country name accented'),
('foreign_geo_terms', 'paraguay',          NULL, 'seed', 'foreign country name'),
('foreign_geo_terms', 'peru',              NULL, 'seed', 'foreign country name'),
('foreign_geo_terms', 'perú',              NULL, 'seed', 'foreign country name accented'),
('foreign_geo_terms', 'santiago de chile', NULL, 'seed', 'foreign city'),
('foreign_geo_terms', 'sao paulo',         NULL, 'seed', 'foreign city'),
('foreign_geo_terms', 'são paulo',         NULL, 'seed', 'foreign city accented'),
('foreign_geo_terms', 'tehuacan',          NULL, 'seed', 'foreign city MX'),
('foreign_geo_terms', 'tehuacán',          NULL, 'seed', 'foreign city MX accented'),

-- foreign_phone_prefixes (geo-penalty.ts FOREIGN_PHONE_PREFIXES)
('foreign_phone_prefixes', '+52',  NULL, 'seed', 'Mexico country code'),
('foreign_phone_prefixes', '+54',  NULL, 'seed', 'Argentina country code'),
('foreign_phone_prefixes', '+55',  NULL, 'seed', 'Brazil country code'),
('foreign_phone_prefixes', '+56',  NULL, 'seed', 'Chile country code'),
('foreign_phone_prefixes', '+57',  NULL, 'seed', 'Colombia country code'),
('foreign_phone_prefixes', '+51',  NULL, 'seed', 'Peru country code'),
('foreign_phone_prefixes', '+591', NULL, 'seed', 'Bolivia country code'),
('foreign_phone_prefixes', '+595', NULL, 'seed', 'Paraguay country code')

ON CONFLICT (list_name, value, COALESCE(scope, '')) DO NOTHING;

-- ============================================================
-- SEED: platform_patterns
-- ============================================================

INSERT INTO platform_patterns (platform_type, pattern, match_type, source) VALUES

-- booking — turnos/citas (hairdresser, general)
('booking', 'booksy.com',    'domain', 'seed'),
('booking', 'fresha.com',    'domain', 'seed'),
('booking', 'genbook.com',   'domain', 'seed'),
('booking', 'simplybook.me', 'domain', 'seed'),
('booking', 'calendly.com',  'domain', 'seed'),

-- reservation — restaurant bookings
('reservation', 'reservando.uy', 'domain', 'seed'),
('reservation', 'thefork.com',   'domain', 'seed'),
('reservation', 'opentable.com', 'domain', 'seed'),

-- delivery
('delivery', 'pedidosya.com',  'domain', 'seed'),
('delivery', 'rappi.com',      'domain', 'seed'),
('delivery', 'ifood.com',      'domain', 'seed'),
('delivery', 'ifood.com.uy',   'domain', 'seed'),

-- class_booking — gym/fitness
('class_booking', 'mindbody.io',   'domain', 'seed'),
('class_booking', 'wodify.com',    'domain', 'seed'),
('class_booking', 'classpass.com', 'domain', 'seed'),
('class_booking', 'booksy.com',    'domain', 'seed'),

-- app_store
('app_store', 'play.google.com/store/apps', 'substring', 'seed'),
('app_store', 'apps.apple.com',             'domain',    'seed'),

-- menu_keyword — page text signals for food delivery
('menu_keyword', 'pedidosya',   'keyword', 'seed'),
('menu_keyword', 'ifood',       'keyword', 'seed'),
('menu_keyword', 'menupiu',     'keyword', 'seed'),
('menu_keyword', 'ver carta',   'keyword', 'seed'),
('menu_keyword', 'ver menu',    'keyword', 'seed'),
('menu_keyword', 'escanear qr', 'keyword', 'seed'),

-- catalog_keyword — page text signals for car/product catalogs
('catalog_keyword', 'catálogo',    'keyword', 'seed'),
('catalog_keyword', 'catalogo',    'keyword', 'seed'),
('catalog_keyword', 'stock',       'keyword', 'seed'),
('catalog_keyword', '0km',         'keyword', 'seed'),
('catalog_keyword', 'usados',      'keyword', 'seed'),
('catalog_keyword', 'kilometraje', 'keyword', 'seed'),

-- chat_widget — script/URL substrings present on pages with live chat
('chat_widget', 'tawk.to',                          'substring', 'seed'),
('chat_widget', 'intercom.io',                      'substring', 'seed'),
('chat_widget', 'widget.intercom.io',               'substring', 'seed'),
('chat_widget', 'crisp.chat',                       'substring', 'seed'),
('chat_widget', 'client.crisp.chat',                'substring', 'seed'),
('chat_widget', 'tidio.co',                         'substring', 'seed'),
('chat_widget', 'code.tidio.co',                    'substring', 'seed'),
('chat_widget', 'livechat.com',                     'substring', 'seed'),
('chat_widget', 'cdn.livechatinc.com',              'substring', 'seed'),
('chat_widget', 'zendesk.com/embeddable_framework', 'substring', 'seed'),
('chat_widget', 'freshchat.com',                    'substring', 'seed'),
('chat_widget', 'wchat.freshchat.com',              'substring', 'seed')

ON CONFLICT (platform_type, pattern) DO NOTHING;

-- ============================================================
-- SEED: niche_mappings
-- ============================================================

INSERT INTO niche_mappings (niche, term, mapping_type, target_value, match_type, source_system) VALUES

-- descriptor_words (heuristic-discovery.ts DESCRIPTOR_WORDS: word → abbreviation)
-- niche='all': applies across every niche
('all', 'peluqueria',  'descriptor_word', 'pelu',   'exact', NULL),
('all', 'peluquerias', 'descriptor_word', 'pelu',   'exact', NULL),
('all', 'barberia',    'descriptor_word', 'barber', 'exact', NULL),
('all', 'barberias',   'descriptor_word', 'barber', 'exact', NULL),

-- niche_stop_words — car dealer
('car_dealer', 'motors',        'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'motor',         'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'autos',         'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'auto',          'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'automovil',     'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'automoviles',   'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'vehiculo',      'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'vehiculos',     'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'propios',       'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'concesionaria', 'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'automotora',    'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'automotores',   'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'garage',        'niche_stop_word', NULL, 'exact', NULL),
('car_dealer', 'taller',        'niche_stop_word', NULL, 'exact', NULL),

-- niche_stop_words — hairdresser/barbershop
('hairdresser', 'coiffeur',  'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'estilista',  'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'peluquero',  'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'peluquera',  'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'peinados',   'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'peinado',    'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'barbero',    'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'cortes',     'niche_stop_word', NULL, 'exact', NULL),
('hairdresser', 'corte',      'niche_stop_word', NULL, 'exact', NULL),

-- niche_stop_words — gym/fitness
('gym', 'fitness',     'niche_stop_word', NULL, 'exact', NULL),
('gym', 'sport',       'niche_stop_word', NULL, 'exact', NULL),
('gym', 'sports',      'niche_stop_word', NULL, 'exact', NULL),
('gym', 'training',    'niche_stop_word', NULL, 'exact', NULL),
('gym', 'crossfit',    'niche_stop_word', NULL, 'exact', NULL),
('gym', 'spinning',    'niche_stop_word', NULL, 'exact', NULL),
('gym', 'cardio',      'niche_stop_word', NULL, 'exact', NULL),
('gym', 'musculacion', 'niche_stop_word', NULL, 'exact', NULL),

-- niche_stop_words — generic (all niches); mirrors niche_vocabulary universal seeds
('all', 'center',     'niche_stop_word', NULL, 'exact', NULL),
('all', 'centre',     'niche_stop_word', NULL, 'exact', NULL),
('all', 'centro',     'niche_stop_word', NULL, 'exact', NULL),
('all', 'studio',     'niche_stop_word', NULL, 'exact', NULL),
('all', 'estudio',    'niche_stop_word', NULL, 'exact', NULL),
('all', 'group',      'niche_stop_word', NULL, 'exact', NULL),
('all', 'grupo',      'niche_stop_word', NULL, 'exact', NULL),
('all', 'servicios',  'niche_stop_word', NULL, 'exact', NULL),
('all', 'service',    'niche_stop_word', NULL, 'exact', NULL),
('all', 'services',   'niche_stop_word', NULL, 'exact', NULL),
('all', 'soluciones', 'niche_stop_word', NULL, 'exact', NULL),
('all', 'solutions',  'niche_stop_word', NULL, 'exact', NULL),

-- niche_aliases (discovery/filters.ts normalizeNiche — raw.includes(term))
('hairdresser', 'peluquer',   'niche_alias', NULL, 'contains', NULL),
('hairdresser', 'barber',     'niche_alias', NULL, 'contains', NULL),
('hairdresser', 'hair',       'niche_alias', NULL, 'contains', NULL),
('car_dealer',  'concesion',  'niche_alias', NULL, 'contains', NULL),
('car_dealer',  'automovil',  'niche_alias', NULL, 'contains', NULL),
('car_dealer',  'auto',       'niche_alias', NULL, 'contains', NULL),
('car_dealer',  'car dealer', 'niche_alias', NULL, 'contains', NULL),
('restaurant',  'restaurant', 'niche_alias', NULL, 'contains', NULL),
('restaurant',  'restaurante','niche_alias', NULL, 'contains', NULL),
('restaurant',  'parrilla',   'niche_alias', NULL, 'contains', NULL),
('gym',         'gimnasio',   'niche_alias', NULL, 'contains', NULL),
('gym',         'gym',        'niche_alias', NULL, 'contains', NULL),
('gym',         'fitness',    'niche_alias', NULL, 'contains', NULL),
('healthcare',  'clinica',    'niche_alias', NULL, 'contains', NULL),
('healthcare',  'medic',      'niche_alias', NULL, 'contains', NULL),
('healthcare',  'healthcare', 'niche_alias', NULL, 'contains', NULL),
('dentist',     'dentista',   'niche_alias', NULL, 'contains', NULL),
('dentist',     'odontolog',  'niche_alias', NULL, 'contains', NULL),
('dentist',     'dentist',    'niche_alias', NULL, 'contains', NULL),

-- directory_category_map (enrichment.yaml niche_category_map — YAML values are authoritative)
-- Discrepancy vs DEFAULT_NICHE_CATEGORY_MAP in directory-discovery.ts — YAML wins.
('hairdresser',  'hairdresser',  'directory_category', 'Peluqueros',          'exact', 'yelu'),
('car_dealer',   'car_dealer',   'directory_category', 'Venta_de_Vehículos',  'exact', 'yelu'),
('gym',          'gym',          'directory_category', 'Fitness',             'exact', 'yelu'),
('restaurant',   'restaurant',   'directory_category', 'Restaurantes',        'exact', 'yelu'),
('accommodation','accommodation','directory_category', 'Hoteles',             'exact', 'yelu'),
('pharmacy',     'pharmacy',     'directory_category', NULL,                  'exact', 'yelu'),
('grocery',      'grocery',      'directory_category', 'Supermercado',        'exact', 'yelu'),
('dentist',      'dentist',      'directory_category', 'Dentistas',           'exact', 'yelu'),
('healthcare',   'healthcare',   'directory_category', 'Médicos_y_Clínicos',  'exact', 'yelu'),
('other',        'other',        'directory_category', NULL,                  'exact', 'yelu')

ON CONFLICT (niche, term, mapping_type) DO NOTHING;
