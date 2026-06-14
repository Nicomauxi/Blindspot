// F6.4 — Pool central de User-Agents. Antes cada módulo definía el suyo.
// - BOT_USER_AGENT: identificación honesta para APIs/sitios que la aceptan.
// - OSM_USER_AGENT: Nominatim/Overpass exigen UA identificable con contacto.
// - BROWSER_USER_AGENT: scraping de buscadores que bloquean UAs de bot.
export const BOT_USER_AGENT = "blindspot/1.0";
export const OSM_USER_AGENT = "blindspot-discovery/1.0 (contact@blindspot.uy)";
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
