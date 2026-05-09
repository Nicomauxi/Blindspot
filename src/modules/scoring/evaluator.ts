import type { Lead } from "../../shared/types.js";
import type { ScoringRule } from "./types.js";

export function resolveField(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

export function evaluateRule(
  rule: ScoringRule,
  lead: Lead
): { matched: boolean; value: unknown } {
  const cond = rule.condition;

  if ("tag" in cond) {
    const matched = lead.tags.includes(cond.tag);
    return { matched, value: matched ? cond.tag : null };
  }

  const raw = resolveField(lead, cond.field);
  if (raw == null) return { matched: false, value: null };

  const { op, value } = cond;
  switch (op) {
    case "eq":
      return { matched: raw === value, value: raw };
    case "gte":
      return { matched: (raw as number) >= (value as number), value: raw };
    case "lte":
      return { matched: (raw as number) <= (value as number), value: raw };
    case "between": {
      const [min, max] = value as [number, number];
      const n = raw as number;
      return { matched: n >= min && n <= max, value: raw };
    }
  }
}
