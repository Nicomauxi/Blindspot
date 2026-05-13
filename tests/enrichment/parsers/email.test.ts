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

  it("uses custom blocked domains without blocking default domains", () => {
    const result = parseEmails(
      `
      <html><body>
        <p>contacto@custom.com soporte@sentry.io ventas@negocio.uy</p>
      </body></html>
    `,
      { blockedDomains: new Set(["custom.com"]) }
    );

    expect(result.emails).toEqual(["soporte@sentry.io", "ventas@negocio.uy"]);
  });

  it("uses custom blocked prefixes", () => {
    const result = parseEmails(
      `
      <html><body>
        <p>info@negocio.uy ventas@negocio.uy</p>
      </body></html>
    `,
      { blockedPrefixes: ["info"] }
    );

    expect(result.emails).toEqual(["ventas@negocio.uy"]);
  });

  it("keeps default parsing when ctx is omitted", () => {
    const result = parseEmails("<html><body><p>test@example.com ventas@negocio.uy</p></body></html>");

    expect(result.emails).toEqual(["ventas@negocio.uy"]);
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

  it("rejects glued local parts before a free email inbox", () => {
    const result = parseEmails("<html><body><p>contactameclaudiauy.info@gmail.com</p></body></html>");

    expect(result.emails).not.toContain("contactameclaudiauy.info@gmail.com");
    expect(result.has_contact_email).toBe(false);
  });

  it("accepts standalone free email inboxes", () => {
    const result = parseEmails("<html><body><p>info@gmail.com</p></body></html>");

    expect(result.emails).toContain("info@gmail.com");
  });

  it("accepts valid local parts with dots", () => {
    const result = parseEmails("<html><body><p>nombre.apellido@negocio.com.uy</p></body></html>");

    expect(result.emails).toContain("nombre.apellido@negocio.com.uy");
  });

  it("rejects local parts longer than 64 characters", () => {
    const local = "a".repeat(65);
    const result = parseEmails(`<html><body><p>${local}@negocio.uy</p></body></html>`);

    expect(result.emails).toEqual([]);
  });

  it("rejects local parts with consecutive dots", () => {
    const result = parseEmails("<html><body><p>a..b@negocio.uy</p></body></html>");

    expect(result.emails).toEqual([]);
  });

  it("rejects local parts with a leading dot", () => {
    const result = parseEmails("<html><body><p>.start@negocio.uy</p></body></html>");

    expect(result.emails).toEqual([]);
  });

  it("rejects emails with foreign compound TLDs", () => {
    const result = parseEmails(
      "<html><body><p>info@negocio.co.uk</p></body></html>",
      { foreignEmailTlds: new Set(["co.uk", "com.ar"]) }
    );

    expect(result.emails).toEqual([]);
  });

  it("accepts generic .com emails when the TLD is not marked foreign", () => {
    const result = parseEmails(
      "<html><body><p>general@hamwi-int.com</p></body></html>",
      { foreignEmailTlds: new Set(["co.uk", "com.ar"]) }
    );

    expect(result.emails).toEqual(["general@hamwi-int.com"]);
  });

  it("rejects emails with foreign country domains", () => {
    const result = parseEmails(
      "<html><body><p>ventas@negocio.com.ar</p></body></html>",
      { foreignEmailTlds: new Set(["co.uk", "com.ar"]) }
    );

    expect(result.emails).toEqual([]);
  });

  it("accepts Uruguay business domains with foreign TLD filtering enabled", () => {
    const result = parseEmails(
      "<html><body><p>contacto@negocio.com.uy</p></body></html>",
      { foreignEmailTlds: new Set(["co.uk", "com.ar"]) }
    );

    expect(result.emails).toEqual(["contacto@negocio.com.uy"]);
  });

  it("accepts free email providers when the TLD is not foreign", () => {
    const result = parseEmails(
      "<html><body><p>info@gmail.com</p></body></html>",
      { foreignEmailTlds: new Set(["co.uk", "com.ar"]) }
    );

    expect(result.emails).toEqual(["info@gmail.com"]);
  });
});
