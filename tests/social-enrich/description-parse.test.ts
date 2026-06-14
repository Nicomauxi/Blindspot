import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSocialDescription } from "../../src/modules/social-enrich/description-parse.js";

const IL_BARETTO = `A metros del puerto y del Faro. Abierto de viernes a domingo, medio día y noche.
12 a 16h - 19 a 00h
Reservas : +598 42445565 y + 59895808099`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["LLM_PROVIDER"];
  delete process.env["GEMINI_API_KEY"];
});

describe("parseSocialDescription — regex ($0, sin red)", () => {
  it("caso real Il Baretto: extrae ambos teléfonos y horarios", async () => {
    const result = await parseSocialDescription(IL_BARETTO, "facebook", { allowLlm: false });
    expect(result.phones).toEqual(expect.arrayContaining(["+59842445565", "+59895808099"]));
    expect(result.phones).toHaveLength(2);
    expect(result.hours).toBeTruthy();
    expect(result.method).toBe("regex");
  });

  it("extrae email y website de negocio (descarta plataformas)", async () => {
    const text = "Contacto: hola@ejemplo.com.uy web https://ejemplo.com.uy seguinos en instagram.com/foo";
    const result = await parseSocialDescription(text, "instagram", { allowLlm: false });
    expect(result.emails).toEqual(["hola@ejemplo.com.uy"]);
    expect(result.website).toBe("https://ejemplo.com.uy");
  });

  it("texto vacío => method none, sin throw", async () => {
    const result = await parseSocialDescription("", "facebook", { allowLlm: false });
    expect(result.method).toBe("none");
    expect(result.phones).toEqual([]);
  });

  it("NO confunde fechas (YYYY-MM-DD) con teléfonos uruguayos", async () => {
    const text = "Local desde 2024-01-01. Eventos el 15/03/2025 y 2024-12-31.";
    const result = await parseSocialDescription(text, "facebook", { allowLlm: false });
    expect(result.phones).toEqual([]);
  });

  it("descarta números no reconocibles como teléfono UY (IDs/años)", async () => {
    const text = "Seguinos! Código 12345678 ref 87654321";
    const result = await parseSocialDescription(text, "instagram", { allowLlm: false });
    // 12345678 y 87654321 no son teléfonos UY válidos (no empiezan 9/2/3/4) → descartados
    expect(result.phones).toEqual([]);
  });

  it("sin credenciales LLM no rompe y queda en regex aunque allowLlm sea true", async () => {
    const result = await parseSocialDescription(IL_BARETTO, "facebook", { allowLlm: true });
    expect(result.method).toBe("regex");
    expect(result.phones).toHaveLength(2);
  });
});

describe("parseSocialDescription — fallback LLM (mock)", () => {
  it("invoca LLM y suma oferta/horario cuando hay credenciales", async () => {
    process.env["LLM_PROVIDER"] = "gemini";
    process.env["GEMINI_API_KEY"] = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ hours: "L a V 9 a 18", offer: "Restaurante italiano" }) }] } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    // Texto largo (>=40 chars) y sin horarios por regex → dispara el fallback LLM.
    const result = await parseSocialDescription(
      "Somos un emprendimiento familiar dedicado a la gastronomía artesanal del barrio",
      "facebook",
      { allowLlm: true }
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.offer).toBe("Restaurante italiano");
    expect(result.method).toBe("llm");
  });

  it("JSON malformado del LLM degrada a regex sin romper", async () => {
    process.env["LLM_PROVIDER"] = "gemini";
    process.env["GEMINI_API_KEY"] = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "no soy json {" }] } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    // Texto sin horarios por regex (dispara LLM), con un teléfono válido para tener regex base.
    const result = await parseSocialDescription(
      "Emprendimiento de cosmética natural y sustentable. Contacto +598 99123456",
      "facebook",
      { allowLlm: true }
    );
    expect(result.method).toBe("regex");
    expect(result.phones).toContain("+59899123456");
  });
});
