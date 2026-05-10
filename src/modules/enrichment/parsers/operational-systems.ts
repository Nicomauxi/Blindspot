import * as cheerio from "cheerio";
import { getLogger } from "../../../shared/logger.js";
import type { OperationalSystemsSignal } from "../../../shared/types.js";

const BOOKING_PLATFORMS = [
  "booksy.com",
  "fresha.com",
  "genbook.com",
  "simplybook.me",
  "calendly.com",
];
const RESERVATION_PLATFORMS = ["reservando.uy", "thefork.com", "opentable.com"];
const DELIVERY_PLATFORMS = ["pedidosya.com", "rappi.com", "ifood.com", "ifood.com.uy"];
const CLASS_BOOKING_PLATFORMS = ["mindbody.io", "wodify.com", "classpass.com", "booksy.com"];
const APP_STORE_PLATFORMS = ["play.google.com/store/apps", "apps.apple.com"];
const MENU_KEYWORDS = ["pedidosya", "ifood", "menupiu", "ver carta", "ver menu", "escanear qr"];
const CATALOG_KEYWORDS = ["catálogo", "catalogo", "stock", "0km", "usados", "kilometraje"];

function emptySignal(): OperationalSystemsSignal {
  return {
    booking_platforms: [],
    reservation_platforms: [],
    delivery_platforms: [],
    menu_links: [],
    menu_keywords: [],
    class_booking_platforms: [],
    app_store_links: [],
    catalog_keywords: [],
    contact_form: false,
    chat_widget: false,
  };
}

function includesAnyUrl(urls: string[], platform: string): boolean {
  return urls.some((url) => url.includes(platform));
}

function presentPlatforms(urls: string[], platforms: string[]): string[] {
  return platforms.filter((platform) => includesAnyUrl(urls, platform));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseOperationalSystems(html: string): OperationalSystemsSignal {
  try {
    const $ = cheerio.load(html);
    const hrefs = $("a[href]")
      .map((_, el) => ($(el).attr("href") ?? "").trim().toLowerCase())
      .get()
      .filter(Boolean);
    const scriptSrcs = $("script[src]")
      .map((_, el) => ($(el).attr("src") ?? "").trim().toLowerCase())
      .get()
      .filter(Boolean);
    const htmlLower = html.toLowerCase();
    const textLower = $("body").text().toLowerCase();
    const urls = [...hrefs, ...scriptSrcs];

    const menu_links = hrefs.filter((href) => {
      const path = href.split("?")[0] ?? href;
      return path.endsWith(".pdf") && (path.includes("menu") || path.includes("carta"));
    });

    const menu_keywords = MENU_KEYWORDS.filter((keyword) => textLower.includes(keyword));
    const catalog_keywords = CATALOG_KEYWORDS.filter((keyword) => textLower.includes(keyword));
    const contact_form =
      $("form").length > 0 ||
      htmlLower.includes("contact-form") ||
      htmlLower.includes("cotizar");
    const chat_widget =
      hrefs.some((href) => href.includes("wa.me/") || href.includes("api.whatsapp.com/send")) ||
      urls.some((url) => url.includes("tawk.to"));

    return {
      booking_platforms: unique(presentPlatforms(urls, BOOKING_PLATFORMS)),
      reservation_platforms: unique(presentPlatforms(urls, RESERVATION_PLATFORMS)),
      delivery_platforms: unique(presentPlatforms(urls, DELIVERY_PLATFORMS)),
      menu_links: unique(menu_links),
      menu_keywords,
      class_booking_platforms: unique(presentPlatforms(urls, CLASS_BOOKING_PLATFORMS)),
      app_store_links: unique(presentPlatforms(urls, APP_STORE_PLATFORMS)),
      catalog_keywords,
      contact_form,
      chat_widget,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn({ parser: "operational-systems", err: msg }, "parser failed");
    return emptySignal();
  }
}
