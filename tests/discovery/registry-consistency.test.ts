import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import type { DiscoverySource } from "../../src/shared/types.js";
import {
  DISCOVERY_SOURCE_META,
  ALL_DISCOVERY_SOURCES,
  ACTIVE_SCORED_SOURCES,
  SIGNAL_ONLY_SOURCES,
  DB_CONSTRAINED_SOURCES,
  EXTERNAL_DISCOVERY_SOURCES,
} from "../../src/shared/discovery-sources.js";
import { buildProvider, WIRED_PROVIDER_SOURCES } from "../../src/modules/discovery/registry.js";

const REPO_ROOT = join(__dirname, "..", "..");
const sorted = (xs: readonly string[]): string[] => [...xs].sort();
const sleepFn = (): Promise<void> => Promise.resolve();

// CHECK efectivo de un constraint = el ÚLTIMO `ADD CONSTRAINT <name> ... CHECK (... ARRAY[...])`
// a través de TODAS las migraciones (cada migración hace DROP+ADD; gana la más reciente). Tolera
// cualquier cast ('x'::text / ::varchar / sin cast) para no romperse si cambia el estilo SQL.
function effectiveCheckSources(migrationsDir: string, constraintName: string): string[] {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const addRe = new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(([\\s\\S]*?ARRAY\\[[\\s\\S]*?\\][\\s\\S]*?)\\)`, "gi");
  let lastArrayBody: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    for (const m of sql.matchAll(addRe)) {
      const arr = m[1]!.match(/ARRAY\[([\s\S]*?)\]/);
      if (arr) lastArrayBody = arr[1]!;
    }
  }
  if (lastArrayBody === null) throw new Error(`No ADD CONSTRAINT ${constraintName} with ARRAY found in migrations`);
  return [...lastArrayBody.matchAll(/'([a-z_]+)'(?:::[a-z ]+)?/gi)].map((m) => m[1]!);
}

describe("provider registry consistency (SoT = shared/discovery-sources)", () => {
  it("la metadata cubre exactamente el union DiscoverySource (11 fuentes)", () => {
    expect(ALL_DISCOVERY_SOURCES).toHaveLength(11);
    // Si se agrega un miembro al union sin entrada en DISCOVERY_SOURCE_META, el Record no compila.
    expect(sorted(Object.keys(DISCOVERY_SOURCE_META))).toEqual(sorted(ALL_DISCOVERY_SOURCES));
  });

  it("DB CHECK efectivo (leads + lead_source_references) == DB_CONSTRAINED_SOURCES", () => {
    const migrationsDir = join(REPO_ROOT, "supabase/migrations");
    const leadsCheck = effectiveCheckSources(migrationsDir, "leads_source_check");
    const lsrCheck = effectiveCheckSources(migrationsDir, "lead_source_references_source_check");
    expect(sorted(leadsCheck)).toEqual(sorted(DB_CONSTRAINED_SOURCES));
    expect(sorted(lsrCheck)).toEqual(sorted(DB_CONSTRAINED_SOURCES));
  });

  it("las factories cableadas == EXTERNAL_DISCOVERY_SOURCES", () => {
    expect(sorted(WIRED_PROVIDER_SOURCES)).toEqual(sorted(EXTERNAL_DISCOVERY_SOURCES));
  });

  it("cada provider cableado expone source y sourceConfidence iguales a la metadata", () => {
    for (const source of WIRED_PROVIDER_SOURCES) {
      const provider = buildProvider(source, { sleepFn });
      expect(provider.source).toBe(source);
      expect(provider.sourceConfidence).toBe(DISCOVERY_SOURCE_META[source as DiscoverySource].sourceConfidence);
    }
  });

  it("buildProvider lanza para una fuente no cableada", () => {
    expect(() => buildProvider("dgi", { sleepFn })).toThrow(/Unknown provider source/);
  });

  it("cada escenario de scoring-calibration.yaml cubre todas las ACTIVE_SCORED_SOURCES", () => {
    const yaml = load(readFileSync(join(REPO_ROOT, "config/scoring-calibration.yaml"), "utf-8")) as {
      scenarios: Record<string, { source_quality_bonus?: Record<string, number> }>;
    };
    for (const [name, scenario] of Object.entries(yaml.scenarios)) {
      const keys = Object.keys(scenario.source_quality_bonus ?? {});
      for (const source of ACTIVE_SCORED_SOURCES) {
        expect(keys, `escenario ${name} sin bonus para ${source}`).toContain(source);
      }
    }
  });

  it("SIGNAL_ONLY_SOURCES derivado == {pedidosya}", () => {
    expect([...SIGNAL_ONLY_SOURCES]).toEqual(["pedidosya"]);
  });
});
