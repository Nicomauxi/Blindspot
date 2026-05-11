import { describe, expect, it } from "vitest";
import { parseEmails } from "../../../src/modules/enrichment/parsers/email.js";

describe("parseEmails", () => {
  it("prioritizes mailto emails over visible text and deduplicates", () => {
    const result = parseEmails(`
      <html><body>
        <a href="mailto:ventas@negocio.uy?subject=Hola">Contacto</a>
        <p>También escribinos a ventas@negocio.uy o soporte@negocio.uy</p>
      </body></html>
    `);

    expect(result).toEqual({
      emails: ["ventas@negocio.uy", "soporte@negocio.uy"],
      has_contact_email: true,
    });
  });

  it("ignores emails inside script and style tags", () => {
    const result = parseEmails(`
      <html>
        <head>
          <style>.x:after { content: "style@negocio.uy"; }</style>
          <script>window.user = "script@negocio.uy";</script>
        </head>
        <body><p>hola@negocio.uy</p></body>
      </html>
    `);

    expect(result.emails).toEqual(["hola@negocio.uy"]);
  });

  it("filters known false positives and noreply-style addresses", () => {
    const result = parseEmails(`
      <html><body>
        <p>test@example.com sentry@sentry.io info@shopify.com</p>
        <p>noreply@negocio.uy bounce@negocio.uy mailer@negocio.uy</p>
        <p>reservas@negocio.uy</p>
      </body></html>
    `);

    expect(result.emails).toEqual(["reservas@negocio.uy"]);
  });

  it("filters hosting-provider emails without blocking business domains", () => {
    const result = parseEmails(`
      <html><body>
        <p>soporte@thinkit.com.uy concept@smartserv.com.uy tracy@enaming.com</p>
        <p>comercial@negocio.com.uy</p>
      </body></html>
    `);

    expect(result.emails).toEqual(["comercial@negocio.com.uy"]);
  });

  it("returns at most three normalized lowercase emails", () => {
    const result = parseEmails(`
      <html><body>
        <p>A@Negocio.uy b@negocio.uy c@negocio.uy d@negocio.uy</p>
      </body></html>
    `);

    expect(result.emails).toEqual(["a@negocio.uy", "b@negocio.uy", "c@negocio.uy"]);
    expect(result.has_contact_email).toBe(true);
  });

  it("reports missing email when none are useful", () => {
    const result = parseEmails("<html><body><p>Sin correo visible</p></body></html>");

    expect(result).toEqual({ emails: [], has_contact_email: false });
  });
});
