import { describe, expect, it } from "vitest";
import { parseHoursOnWeb } from "../../../src/modules/enrichment/parsers/hours-web.js";

describe("parseHoursOnWeb", () => {
  it("detects schema.org OpeningHoursSpecification in JSON-LD", () => {
    const result = parseHoursOnWeb(`
      <html><head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "openingHoursSpecification": [{
              "@type": "OpeningHoursSpecification",
              "dayOfWeek": "Monday",
              "opens": "09:00",
              "closes": "18:00"
            }]
          }
        </script>
      </head><body></body></html>
    `);

    expect(result).toEqual({ has_hours_on_web: true, source: "schema" });
  });

  it("detects common Spanish opening-hours keywords", () => {
    const result = parseHoursOnWeb(`
      <html><body><p>Horario de atención: lunes a viernes de 9 a 18.</p></body></html>
    `);

    expect(result).toEqual({ has_hours_on_web: true, source: "text" });
  });

  it("detects weekdays followed by hour ranges with accents", () => {
    const result = parseHoursOnWeb(`
      <html><body><p>Sábado 10:00 a 14:30</p></body></html>
    `);

    expect(result).toEqual({ has_hours_on_web: true, source: "text" });
  });

  it("ignores scripts when searching visible text", () => {
    const result = parseHoursOnWeb(`
      <html><body>
        <script>const text = "lunes a viernes de 9 a 18";</script>
        <p>Contacto por agenda.</p>
      </body></html>
    `);

    expect(result).toEqual({ has_hours_on_web: false, source: null });
  });

  it("returns false when no hours are present", () => {
    const result = parseHoursOnWeb("<html><body><p>Bienvenidos</p></body></html>");

    expect(result).toEqual({ has_hours_on_web: false, source: null });
  });
});
