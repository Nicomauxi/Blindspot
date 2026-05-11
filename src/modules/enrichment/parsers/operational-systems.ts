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
const CHAT_WIDGET_PATTERNS = [
  "tawk.to",
  "intercom.io",
  "widget.intercom.io",
  "crisp.chat",
  "client.crisp.chat",
  "tidio.co",
  "code.tidio.co",
  "livechat.com",
  "cdn.livechatinc.com",
  "zendesk.com/embeddable_framework",
  "freshchat.com",
  "wchat.freshchat.com",
];

export interface OperationalSystemsCtx {
  reservationPlatforms?: readonly string[];
  deliveryPlatforms?: readonly string[];
  classBookingPlatforms?: readonly string[];
  appStorePlatforms?: readonly string[];
  menuKeywords?: readonly string[];
  catalogKeywords?: readonly string[];
  chatWidgetPatterns?: readonly string[];
}

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

function presentPlatforms(urls: string[], platforms: readonly string[]): string[] {
  return platforms.filter((platform) => includesAnyUrl(urls, platform));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseOperationalSystems(
  html: string,
  ctx?: OperationalSystemsCtx
): OperationalSystemsSignal {
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
    const inlineScripts = $("script")
      .map((_, el) => $(el).text().trim().toLowerCase())
      .get()
      .filter(Boolean);
    const urls = [...hrefs, ...scriptSrcs, ...inlineScripts];

    const menu_links = hrefs.filter((href) => {
      const path = href.split("?")[0] ?? href;
      return path.endsWith(".pdf") && (path.includes("menu") || path.includes("carta"));
    });

    const reservationPlatforms = ctx?.reservationPlatforms ?? RESERVATION_PLATFORMS;
    const deliveryPlatforms = ctx?.deliveryPlatforms ?? DELIVERY_PLATFORMS;
    const classBookingPlatforms = ctx?.classBookingPlatforms ?? CLASS_BOOKING_PLATFORMS;
    const appStorePlatforms = ctx?.appStorePlatforms ?? APP_STORE_PLATFORMS;
    const menuKeywords = ctx?.menuKeywords ?? MENU_KEYWORDS;
    const catalogKeywords = ctx?.catalogKeywords ?? CATALOG_KEYWORDS;
    const chatWidgetPatterns = ctx?.chatWidgetPatterns ?? CHAT_WIDGET_PATTERNS;

    const menu_keywords = menuKeywords.filter((keyword) => textLower.includes(keyword));
    const catalog_keywords = catalogKeywords.filter((keyword) => textLower.includes(keyword));
    const contact_form =
      $("form").length > 0 ||
      htmlLower.includes("contact-form") ||
      htmlLower.includes("cotizar");
    const chat_widget = urls.some((url) =>
      chatWidgetPatterns.some((platform) => url.includes(platform))
    );

    return {
      booking_platforms: unique(presentPlatforms(urls, BOOKING_PLATFORMS)),
      reservation_platforms: unique(presentPlatforms(urls, reservationPlatforms)),
      delivery_platforms: unique(presentPlatforms(urls, deliveryPlatforms)),
      menu_links: unique(menu_links),
      menu_keywords,
      class_booking_platforms: unique(presentPlatforms(urls, classBookingPlatforms)),
      app_store_links: unique(presentPlatforms(urls, appStorePlatforms)),
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
