import type {
  DigitalFootprintEnriched,
  InferredState,
  InferredStateField,
  Lead,
} from "../../shared/types.js";

const ECOMMERCE_STACKS = new Set(["Shopify", "WooCommerce", "Tienda Nube", "MercadoShops"]);
const RESERVATION_NICHES = new Set(["gym", "hairdresser"]);

function falseField(): InferredStateField {
  return { value: false, confidence: 0, via: [] };
}

function emptyState(): InferredState {
  return {
    has_reservations:     falseField(),
    has_delivery:         falseField(),
    has_online_catalog:   falseField(),
    has_ecommerce:        falseField(),
    has_pos:              falseField(),
    has_chat_support:     falseField(),
    digitalization_level: "none",
    computed_at:          new Date().toISOString(),
  };
}

export function computeInferredState(
  fp: DigitalFootprintEnriched,
  lead: Pick<Lead, "niche" | "tags" | "source" | "corroborating_sources">
): InferredState {
  const ops = fp.operational_systems;
  if (!ops) return emptyState();

  // has_reservations
  const hasReservations = computeHasReservations(ops, lead);

  // has_delivery
  const hasDelivery = computeHasDelivery(ops, lead);

  // has_ecommerce
  const hasEcommerce = computeHasEcommerce(ops, fp);

  // has_online_catalog (cascades from has_ecommerce)
  const hasOnlineCatalog = computeHasOnlineCatalog(ops, hasEcommerce, lead);

  // has_pos (cascade from has_ecommerce + has_delivery)
  const hasPos = computeHasPos(hasEcommerce, hasDelivery);

  // has_chat_support
  const hasChatSupport = computeHasChatSupport(ops, lead);

  const fields = [hasReservations, hasDelivery, hasOnlineCatalog, hasEcommerce, hasPos, hasChatSupport];
  const activeCount = fields.filter((f) => f.value).length;
  const digitalizationLevel = toDigitalizationLevel(activeCount);

  return {
    has_reservations:     hasReservations,
    has_delivery:         hasDelivery,
    has_online_catalog:   hasOnlineCatalog,
    has_ecommerce:        hasEcommerce,
    has_pos:              hasPos,
    has_chat_support:     hasChatSupport,
    digitalization_level: digitalizationLevel,
    computed_at:          new Date().toISOString(),
  };
}

function computeHasReservations(
  ops: NonNullable<DigitalFootprintEnriched["operational_systems"]>,
  lead: Pick<Lead, "niche" | "tags">
): InferredStateField {
  let confidence = 0;
  const via: string[] = [];

  if ((ops.booking_platforms ?? []).length > 0) {
    confidence = Math.max(confidence, 0.9);
    for (const p of (ops.booking_platforms ?? [])) via.push(`booking_platforms:${p}`);
  }
  if ((ops.reservation_platforms ?? []).length > 0) {
    confidence = Math.max(confidence, 0.9);
    for (const p of (ops.reservation_platforms ?? [])) via.push(`reservation_platforms:${p}`);
  }

  if (via.length > 0) return { value: true, confidence, via };

  if (ops.contact_form && lead.niche !== null && RESERVATION_NICHES.has(lead.niche)) {
    return { value: true, confidence: 0.5, via: ["contact_form", `niche:${lead.niche}`] };
  }

  return falseField();
}

function computeHasDelivery(
  ops: NonNullable<DigitalFootprintEnriched["operational_systems"]>,
  lead: Pick<Lead, "source" | "corroborating_sources">
): InferredStateField {
  const via: string[] = [];
  let confidence = 0;

  if ((ops.delivery_platforms ?? []).length > 0) {
    confidence = Math.max(confidence, 0.8);
    for (const p of (ops.delivery_platforms ?? [])) via.push(`delivery_platforms:${p}`);
  }

  const isPedidosYaPrimary = lead.source === "pedidosya";
  const isPedidosYaCorroborating =
    Array.isArray(lead.corroborating_sources) &&
    lead.corroborating_sources.some((s: { source: string }) => s.source === "pedidosya");

  if (isPedidosYaPrimary || isPedidosYaCorroborating) {
    confidence = Math.max(confidence, 0.95);
    via.push("pedidosya");
  }

  if (via.length > 0) return { value: true, confidence, via };
  return falseField();
}

function computeHasEcommerce(
  ops: NonNullable<DigitalFootprintEnriched["operational_systems"]>,
  fp: DigitalFootprintEnriched
): InferredStateField {
  const via: string[] = [];

  if ((ops.ecommerce_platforms ?? []).length > 0) {
    for (const p of (ops.ecommerce_platforms ?? [])) via.push(`ecommerce_platforms:${p}`);
  }

  if (
    fp.stack &&
    ECOMMERCE_STACKS.has(fp.stack.name) &&
    fp.stack.confidence !== "low"
  ) {
    via.push(`stack:${fp.stack.name}`);
  }

  if (via.length > 0) return { value: true, confidence: 0.95, via };
  return falseField();
}

function computeHasOnlineCatalog(
  ops: NonNullable<DigitalFootprintEnriched["operational_systems"]>,
  hasEcommerce: InferredStateField,
  lead: Pick<Lead, "niche" | "tags">
): InferredStateField {
  let confidence = 0;
  const via: string[] = [];

  if (hasEcommerce.value) {
    confidence = Math.max(confidence, 0.9);
    via.push("has_ecommerce");
  }
  if ((ops.menu_links ?? []).length > 0) {
    confidence = Math.max(confidence, 0.85);
    via.push(...(ops.menu_links ?? []).map((l) => `menu_links:${l}`));
  }
  if ((ops.menu_keywords ?? []).length > 0 && lead.niche === "restaurant") {
    confidence = Math.max(confidence, 0.6);
    via.push(...(ops.menu_keywords ?? []).map((k) => `menu_keywords:${k}`));
  }

  if (via.length > 0) return { value: true, confidence, via };
  return falseField();
}

function computeHasPos(
  hasEcommerce: InferredStateField,
  hasDelivery: InferredStateField
): InferredStateField {
  if (hasEcommerce.value && hasDelivery.value) {
    return { value: true, confidence: 0.7, via: ["has_ecommerce", "has_delivery"] };
  }
  return falseField();
}

function computeHasChatSupport(
  ops: NonNullable<DigitalFootprintEnriched["operational_systems"]>,
  lead: Pick<Lead, "niche" | "tags">
): InferredStateField {
  let confidence = 0;
  const via: string[] = [];

  if (ops.chat_widget) {
    confidence = Math.max(confidence, 0.9);
    via.push("chat_widget");
  }
  const tags: string[] = Array.isArray(lead.tags) ? (lead.tags as string[]) : [];
  if (tags.includes("whatsapp-confirmed")) {
    confidence = Math.max(confidence, 0.85);
    via.push("whatsapp-confirmed");
  }

  if (via.length > 0) return { value: true, confidence, via };
  return falseField();
}

function toDigitalizationLevel(active: number): InferredState["digitalization_level"] {
  if (active === 0) return "none";
  if (active <= 2) return "basic";
  if (active === 3) return "intermediate";
  return "advanced";
}
