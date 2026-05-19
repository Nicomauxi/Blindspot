# Prompt CC — Fase 16: Urgency signals

> ARCHIVO HISTÓRICO. Fase 16 ya figura como completada en el estado actual.
> No ejecutar salvo pedido explícito de Nicolás.

> Enviar a CC después de que Fase 14 (review count multiplicador) esté completa y commiteada.
> Adjuntar context/ARCHITECTURE.md al enviarlo.

---

[Adjuntar context/ARCHITECTURE.md como contexto del sistema]

---

Contexto: Blindspot — pipeline de scoring de leads. Node.js 20 + TypeScript strict. Tests: Vitest (860+ passing aprox.). `scoreLead()` en `src/modules/scoring/index.ts` retorna un `ScoreResult` con `score_breakdown: ScoreBreakdown`. El `ScoreBreakdown` se persiste en la columna JSONB `score_breakdown` de la tabla `leads`.

Tarea: Fase 16 — Señales de urgencia temporal. Agregar campo `urgency_signal: "high" | "medium" | "low"` dentro de `score_breakdown` (NO columna nueva). Se calcula en `scoreLead()` a partir de datos ya disponibles en el lead.

⚠️ Puede haber un pipeline largo corriendo en background. NO correr `score --all` sin `--dry-run`.

---

## Señales a detectar

| Señal | Condición | Nivel |
|---|---|---|
| Web desactualizada | `digital_footprint.copyright_year <= 2020` | `high` |
| Zona turística estacional | `niche IN ("restaurant","hospedaje") AND address incluye zona turística` | `high` |
| Negocio nuevo en radar | `lead.created_at < 90 días atrás` | `medium` |
| Negocio joven en crecimiento | `review_count < 20 AND rating >= 4.0` | `medium` |

Zonas turísticas a detectar (substring en `lead.address?.toLowerCase()`): `"punta del este"`, `"rocha"`, `"cabo polonio"`, `"piriápolis"`, `"barra de valizas"`.

Lógica de resolución: si hay al menos una señal `high` → `"high"`. Si hay al menos una `medium` (y ninguna `high`) → `"medium"`. Si ninguna señal → `"low"`.

---

## Implementación — paso a paso

### Paso 1 — Actualizar `src/modules/scoring/types.ts`

Agregar nuevo tipo:
```typescript
export type UrgencySignal = "high" | "medium" | "low";
```

Agregar campo opcional en `ScoreBreakdown`:
```typescript
urgency_signal?: UrgencySignal;
```

---

### Paso 2 — Crear `src/modules/scoring/urgency.ts`

```typescript
import type { Lead } from "../../shared/types.js";
import type { UrgencySignal } from "./types.js";

const OUTDATED_YEAR_THRESHOLD = 2020;
const RECENTLY_DISCOVERED_DAYS = 90;
const GROWING_REVIEW_THRESHOLD = 20;
const GROWING_RATING_MIN = 4.0;
const TOURIST_NICHES = new Set(["restaurant", "hospedaje"]);
const TOURIST_ZONES = [
  "punta del este",
  "rocha",
  "cabo polonio",
  "piriápolis",
  "barra de valizas",
];

export function computeUrgencySignal(lead: Lead): UrgencySignal {
  const highSignals: string[] = [];
  const mediumSignals: string[] = [];

  // Alta urgencia: web desactualizada
  const fp = lead.digital_footprint;
  const copyrightYear =
    fp && !("skipped" in fp) ? fp.copyright_year ?? null : null;
  if (typeof copyrightYear === "number" && copyrightYear <= OUTDATED_YEAR_THRESHOLD) {
    highSignals.push("copyright_year_old");
  }

  // Alta urgencia: zona turística estacional
  const niche = lead.niche ?? "other";
  const address = (lead.address ?? "").toLowerCase();
  if (
    TOURIST_NICHES.has(niche) &&
    TOURIST_ZONES.some((z) => address.includes(z))
  ) {
    highSignals.push("tourist_zone_seasonal");
  }

  // Media urgencia: negocio nuevo en el radar
  if (lead.created_at) {
    const daysSince =
      (Date.now() - new Date(lead.created_at).getTime()) / 86_400_000;
    if (daysSince < RECENTLY_DISCOVERED_DAYS) {
      mediumSignals.push("recently_discovered");
    }
  }

  // Media urgencia: negocio joven en crecimiento
  const reviewCount = lead.review_count;
  const rating = lead.rating != null ? Number(lead.rating) : null;
  if (
    reviewCount !== null &&
    reviewCount < GROWING_REVIEW_THRESHOLD &&
    rating !== null &&
    rating >= GROWING_RATING_MIN
  ) {
    mediumSignals.push("growing_business");
  }

  if (highSignals.length > 0) return "high";
  if (mediumSignals.length > 0) return "medium";
  return "low";
}
```

---

### Paso 3 — Actualizar `src/modules/scoring/index.ts`

Agregar import:
```typescript
import { computeUrgencySignal } from "./urgency.js";
```

Dentro de `scoreLead()`, después de calcular `prospectScore` y antes del `return`:
```typescript
const urgencySignal = computeUrgencySignal(lead);
```

En el objeto `score_breakdown` del `return`, agregar el campo:
```typescript
urgency_signal: urgencySignal,
```

---

### Paso 4 — Tests en `tests/scoring/urgency.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { computeUrgencySignal } from "../../src/modules/scoring/urgency.js";
import type { Lead } from "../../src/shared/types.js";
import { empty_lead } from "./fixtures/leads.js";

function lead(overrides: Partial<Lead> = {}): Lead {
  return { ...empty_lead, ...overrides };
}

function withCopyrightYear(year: number): Partial<Lead> {
  return {
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00Z",
      copyright_year: year,
    },
  } as unknown as Partial<Lead>;
}

describe("high urgency — copyright_year", () => {
  it("copyright_year 2020 → high", () => {
    expect(computeUrgencySignal(lead(withCopyrightYear(2020)))).toBe("high");
  });
  it("copyright_year 2019 → high", () => {
    expect(computeUrgencySignal(lead(withCopyrightYear(2019)))).toBe("high");
  });
  it("copyright_year 2021 → no high por copyright", () => {
    expect(computeUrgencySignal(lead(withCopyrightYear(2021)))).not.toBe("high");
  });
  it("copyright_year null → low", () => {
    expect(computeUrgencySignal(lead())).toBe("low");
  });
});

describe("high urgency — zona turística", () => {
  it("restaurant en Punta del Este → high", () => {
    expect(computeUrgencySignal(lead({ niche: "restaurant", address: "Av. Gorlero 1234, Punta del Este" }))).toBe("high");
  });
  it("restaurant en Rocha → high", () => {
    expect(computeUrgencySignal(lead({ niche: "restaurant", address: "Calle 1, Rocha" }))).toBe("high");
  });
  it("restaurant en Montevideo → no high", () => {
    expect(computeUrgencySignal(lead({ niche: "restaurant", address: "18 de Julio 100, Montevideo" }))).not.toBe("high");
  });
  it("gym en Punta del Este → no high (niche no turístico)", () => {
    expect(computeUrgencySignal(lead({ niche: "gym", address: "Punta del Este" }))).not.toBe("high");
  });
});

describe("medium urgency — negocio nuevo", () => {
  it("created_at hace 30 días → medium", () => {
    const d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(computeUrgencySignal(lead({ created_at: d }))).toBe("medium");
  });
  it("created_at hace 89 días → medium", () => {
    const d = new Date(Date.now() - 89 * 86_400_000).toISOString();
    expect(computeUrgencySignal(lead({ created_at: d }))).toBe("medium");
  });
  it("created_at hace 91 días → low", () => {
    const d = new Date(Date.now() - 91 * 86_400_000).toISOString();
    expect(computeUrgencySignal(lead({ created_at: d }))).toBe("low");
  });
});

describe("medium urgency — negocio en crecimiento", () => {
  it("review_count=15, rating=4.5 → medium", () => {
    expect(computeUrgencySignal(lead({ review_count: 15, rating: 4.5 }))).toBe("medium");
  });
  it("review_count=19, rating=4.0 → medium (threshold exacto)", () => {
    expect(computeUrgencySignal(lead({ review_count: 19, rating: 4.0 }))).toBe("medium");
  });
  it("review_count=20, rating=4.5 → low (fuera del threshold)", () => {
    expect(computeUrgencySignal(lead({ review_count: 20, rating: 4.5 }))).toBe("low");
  });
  it("review_count=10, rating=3.9 → low (rating bajo)", () => {
    expect(computeUrgencySignal(lead({ review_count: 10, rating: 3.9 }))).toBe("low");
  });
});

describe("prioridad: high > medium", () => {
  it("copyright_year + negocio nuevo → high gana", () => {
    const d = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(computeUrgencySignal(lead({ created_at: d, ...withCopyrightYear(2018) }))).toBe("high");
  });
});

describe("sin señales → low", () => {
  it("lead vacío → low", () => {
    expect(computeUrgencySignal(lead())).toBe("low");
  });
});
```

---

### Paso 5 — Verificación

```bash
pnpm test 2>&1 | tail -8 && pnpm typecheck 2>&1 | tail -3

# Spot-check sin persistir
LOG_LEVEL=warn node --env-file=.env --import tsx/esm src/cli/index.ts score --all --dry-run 2>&1 | grep -i "error" | head -5
```

NO correr `score --all` sin `--dry-run`.

---

### Al terminar — si tests pasan y typecheck limpio:

1. Commit:
   ```bash
   git add src/modules/scoring/types.ts \
     src/modules/scoring/urgency.ts \
     src/modules/scoring/index.ts \
     tests/scoring/urgency.test.ts
   git commit -m "feat: Fase 16 — urgency_signal en score_breakdown (high/medium/low)"
   ```

2. Actualizar `context/ARCHITECTURE.md`:
   - Agregar `urgency.ts` al árbol de módulos bajo `scoring/`
   - Actualizar `ScoreBreakdown` en sección Scoring con campo `urgency_signal?: UrgencySignal`
   - Actualizar test count

3. Actualizar `context/FUTURE.md`: borrar sección "Fase 16 — Señales de urgencia temporal"

4. Reescribir sección ESTADO en `context/PROJECT_MASTER.md`

---

Archivos relevantes para leer antes de empezar:
- `src/modules/scoring/types.ts`
- `src/modules/scoring/index.ts`
- `tests/scoring/fixtures/leads.ts`
