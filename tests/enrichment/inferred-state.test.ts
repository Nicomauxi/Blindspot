import { describe, expect, it } from "vitest";
import { computeInferredState } from "../../src/modules/enrichment/inferred-state.js";
import type { DigitalFootprintEnriched, OperationalSystemsSignal } from "../../src/shared/types.js";

function makeOps(overrides: Partial<OperationalSystemsSignal> = {}): OperationalSystemsSignal {
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
    ecommerce_platforms: [],
    whatsapp_web_link: false,
    ...overrides,
  };
}

function makeFp(
  ops: OperationalSystemsSignal | undefined,
  overrides: Partial<DigitalFootprintEnriched> = {}
): DigitalFootprintEnriched {
  return {
    skipped: false,
    fetched_at: new Date().toISOString(),
    operational_systems: ops,
    ...overrides,
  };
}

const baseLead = {
  niche: null as string | null,
  tags: [] as string[],
  source: "google_places" as string,
  corroborating_sources: [] as Array<{ source: string }>,
};

describe("computeInferredState", () => {
  it("contact_form true + niche=gym → has_reservations true, confidence 0.5", () => {
    const fp = makeFp(makeOps({ contact_form: true }));
    const result = computeInferredState(fp, { ...baseLead, niche: "gym" });
    expect(result.has_reservations.value).toBe(true);
    expect(result.has_reservations.confidence).toBe(0.5);
    expect(result.has_reservations.via).toContain("contact_form");
    expect(result.has_reservations.via).toContain("niche:gym");
  });

  it("contact_form true + niche=restaurant → has_reservations false", () => {
    const fp = makeFp(makeOps({ contact_form: true }));
    const result = computeInferredState(fp, { ...baseLead, niche: "restaurant" });
    expect(result.has_reservations.value).toBe(false);
  });

  it("delivery_platforms non-empty → has_delivery true, confidence 0.8", () => {
    const fp = makeFp(makeOps({ delivery_platforms: ["pedidosya"] }));
    const result = computeInferredState(fp, baseLead);
    expect(result.has_delivery.value).toBe(true);
    expect(result.has_delivery.confidence).toBe(0.8);
  });

  it("ops.ecommerce_platforms non-empty → has_ecommerce true, confidence 0.95", () => {
    const fp = makeFp(makeOps({ ecommerce_platforms: ["shopify"] }));
    const result = computeInferredState(fp, baseLead);
    expect(result.has_ecommerce.value).toBe(true);
    expect(result.has_ecommerce.confidence).toBe(0.95);
    expect(result.has_ecommerce.via).toContain("ecommerce_platforms:shopify");
  });

  it("stack.name=Shopify → has_ecommerce true, confidence 0.95, via includes stack:Shopify", () => {
    const fp = makeFp(makeOps(), {
      stack: { name: "Shopify", version: null, confidence: "high" },
    });
    const result = computeInferredState(fp, baseLead);
    expect(result.has_ecommerce.value).toBe(true);
    expect(result.has_ecommerce.confidence).toBe(0.95);
    expect(result.has_ecommerce.via).toContain("stack:Shopify");
  });

  it("stack.name=WordPress → has_ecommerce false", () => {
    const fp = makeFp(makeOps(), {
      stack: { name: "WordPress", version: null, confidence: "high" },
    });
    const result = computeInferredState(fp, baseLead);
    expect(result.has_ecommerce.value).toBe(false);
  });

  it("has_ecommerce true → has_online_catalog cascades true, via=['has_ecommerce']", () => {
    const fp = makeFp(makeOps({ ecommerce_platforms: ["tienda-nube"] }));
    const result = computeInferredState(fp, baseLead);
    expect(result.has_online_catalog.value).toBe(true);
    expect(result.has_online_catalog.via).toContain("has_ecommerce");
  });

  it("menu_links non-empty → has_online_catalog true, confidence 0.85", () => {
    const fp = makeFp(makeOps({ menu_links: ["/menu"] }));
    const result = computeInferredState(fp, baseLead);
    expect(result.has_online_catalog.value).toBe(true);
    expect(result.has_online_catalog.confidence).toBe(0.85);
  });

  it("menu_keywords non-empty + niche=restaurant → has_online_catalog true, confidence 0.6", () => {
    const fp = makeFp(makeOps({ menu_keywords: ["menú del día"] }));
    const result = computeInferredState(fp, { ...baseLead, niche: "restaurant" });
    expect(result.has_online_catalog.value).toBe(true);
    expect(result.has_online_catalog.confidence).toBe(0.6);
  });

  it("chat_widget true → has_chat_support true, confidence 0.9", () => {
    const fp = makeFp(makeOps({ chat_widget: true }));
    const result = computeInferredState(fp, baseLead);
    expect(result.has_chat_support.value).toBe(true);
    expect(result.has_chat_support.confidence).toBe(0.9);
    expect(result.has_chat_support.via).toContain("chat_widget");
  });

  it("tag whatsapp-confirmed → has_chat_support true, confidence 0.85", () => {
    const fp = makeFp(makeOps());
    const result = computeInferredState(fp, { ...baseLead, tags: ["whatsapp-confirmed"] });
    expect(result.has_chat_support.value).toBe(true);
    expect(result.has_chat_support.confidence).toBe(0.85);
    expect(result.has_chat_support.via).toContain("whatsapp-confirmed");
  });

  it("both chat_widget and whatsapp-confirmed → max confidence 0.9, via accumulates both", () => {
    const fp = makeFp(makeOps({ chat_widget: true }));
    const result = computeInferredState(fp, { ...baseLead, tags: ["whatsapp-confirmed"] });
    expect(result.has_chat_support.confidence).toBe(0.9);
    expect(result.has_chat_support.via).toContain("chat_widget");
    expect(result.has_chat_support.via).toContain("whatsapp-confirmed");
  });

  it("has_ecommerce + has_delivery both true → has_pos true, confidence 0.7", () => {
    const fp = makeFp(
      makeOps({ ecommerce_platforms: ["woocommerce"], delivery_platforms: ["rappi"] })
    );
    const result = computeInferredState(fp, baseLead);
    expect(result.has_pos.value).toBe(true);
    expect(result.has_pos.confidence).toBe(0.7);
    expect(result.has_pos.via).toContain("has_ecommerce");
    expect(result.has_pos.via).toContain("has_delivery");
  });

  it("has_ecommerce only → has_pos false", () => {
    const fp = makeFp(makeOps({ ecommerce_platforms: ["woocommerce"] }));
    const result = computeInferredState(fp, baseLead);
    expect(result.has_pos.value).toBe(false);
  });

  it("3 active systems → digitalization_level intermediate", () => {
    // has_ecommerce, has_delivery, has_chat_support = 3 active
    // has_online_catalog cascades from has_ecommerce → 4 active → advanced
    // Use only delivery + chat + booking (no ecommerce to avoid cascade)
    const fp = makeFp(
      makeOps({
        delivery_platforms: ["rappi"],
        chat_widget: true,
        booking_platforms: ["calendly.com"],
      })
    );
    const result = computeInferredState(fp, baseLead);
    expect(result.digitalization_level).toBe("intermediate");
  });

  it("4+ active systems → digitalization_level advanced", () => {
    const fp = makeFp(
      makeOps({
        ecommerce_platforms: ["shopify"],
        delivery_platforms: ["pedidosya"],
        chat_widget: true,
        booking_platforms: ["calendly.com"],
      })
    );
    // ecommerce + delivery + chat + reservations + online_catalog (cascade) + pos (cascade) = 6
    const result = computeInferredState(fp, baseLead);
    expect(result.digitalization_level).toBe("advanced");
  });

  it("1–2 active systems → digitalization_level basic", () => {
    const fp = makeFp(makeOps({ delivery_platforms: ["rappi"] }));
    const result = computeInferredState(fp, baseLead);
    expect(result.digitalization_level).toBe("basic");
  });

  it("fp.operational_systems undefined → all false, no throw", () => {
    const fp = makeFp(undefined);
    expect(() => computeInferredState(fp, baseLead)).not.toThrow();
    const result = computeInferredState(fp, baseLead);
    expect(result.has_reservations.value).toBe(false);
    expect(result.has_delivery.value).toBe(false);
    expect(result.has_ecommerce.value).toBe(false);
    expect(result.has_online_catalog.value).toBe(false);
    expect(result.has_pos.value).toBe(false);
    expect(result.has_chat_support.value).toBe(false);
    expect(result.digitalization_level).toBe("none");
  });

  it("ops.booking_platforms and ops.reservation_platforms both non-empty → max confidence, via accumulates", () => {
    const fp = makeFp(
      makeOps({
        booking_platforms: ["calendly.com"],
        reservation_platforms: ["foratable"],
      })
    );
    const result = computeInferredState(fp, baseLead);
    expect(result.has_reservations.value).toBe(true);
    expect(result.has_reservations.confidence).toBe(0.9);
    expect(result.has_reservations.via).toContain("booking_platforms:calendly.com");
    expect(result.has_reservations.via).toContain("reservation_platforms:foratable");
  });

  it("computed_at is a valid ISO string", () => {
    const fp = makeFp(makeOps());
    const result = computeInferredState(fp, baseLead);
    expect(() => new Date(result.computed_at)).not.toThrow();
    expect(new Date(result.computed_at).toISOString()).toBe(result.computed_at);
  });

  it("pedidosya primary source + no delivery_platforms → has_delivery true, confidence 0.95, via=['pedidosya']", () => {
    const fp = makeFp(makeOps());
    const result = computeInferredState(fp, {
      ...baseLead,
      source: "pedidosya",
      corroborating_sources: [],
    });
    expect(result.has_delivery.value).toBe(true);
    expect(result.has_delivery.confidence).toBe(0.95);
    expect(result.has_delivery.via).toEqual(["pedidosya"]);
  });

  it("pedidosya corroborating source + lead.source='google_places' → has_delivery true, confidence 0.95", () => {
    const fp = makeFp(makeOps());
    const result = computeInferredState(fp, {
      ...baseLead,
      source: "google_places",
      corroborating_sources: [{ source: "pedidosya" }],
    });
    expect(result.has_delivery.value).toBe(true);
    expect(result.has_delivery.confidence).toBe(0.95);
    expect(result.has_delivery.via).toContain("pedidosya");
  });

  it("pedidosya + delivery_platforms → confidence=0.95 (max), via includes both signals", () => {
    const fp = makeFp(makeOps({ delivery_platforms: ["rappi"] }));
    const result = computeInferredState(fp, {
      ...baseLead,
      source: "pedidosya",
      corroborating_sources: [],
    });
    expect(result.has_delivery.value).toBe(true);
    expect(result.has_delivery.confidence).toBe(0.95);
    expect(result.has_delivery.via).toContain("delivery_platforms:rappi");
    expect(result.has_delivery.via).toContain("pedidosya");
  });

  it("no pedidosya, no delivery_platforms → has_delivery false", () => {
    const fp = makeFp(makeOps());
    const result = computeInferredState(fp, {
      ...baseLead,
      source: "google_places",
      corroborating_sources: [],
    });
    expect(result.has_delivery.value).toBe(false);
    expect(result.has_delivery.confidence).toBe(0);
  });

  it("ops con arrays faltantes (schema viejo) → no lanza, retorna emptyState-like", () => {
    const opsViejos = {
      contact_form: false,
      chat_widget: false,
      // sin booking_platforms, reservation_platforms, delivery_platforms, ecommerce_platforms, menu_links, menu_keywords
    } as unknown as import("../../src/shared/types.js").OperationalSystemsSignal;
    const fp = makeFp(opsViejos);
    expect(() => computeInferredState(fp, baseLead)).not.toThrow();
    const result = computeInferredState(fp, baseLead);
    expect(result.has_reservations.value).toBe(false);
    expect(result.has_delivery.value).toBe(false);
    expect(result.has_ecommerce.value).toBe(false);
    expect(result.has_online_catalog.value).toBe(false);
    expect(result.digitalization_level).toBe("none");
  });
});
