import { describe, expect, it } from "vitest";
import { parseOperationalSystems } from "../../../src/modules/enrichment/parsers/operational-systems.js";

describe("parseOperationalSystems", () => {
  it("detects booking, tawk.to chat, and app store links", () => {
    const html = `
      <html><body>
        <a href="https://booksy.com/es-uy/123">Reservar</a>
        <a href="https://wa.me/59899123456">WhatsApp</a>
        <script src="https://embed.tawk.to/site/default"></script>
        <a href="https://play.google.com/store/apps/details?id=com.test.app">App</a>
      </body></html>
    `;
    const result = parseOperationalSystems(html);
    expect(result.booking_platforms).toEqual(["booksy.com"]);
    expect(result.chat_widget).toBe(true);
    expect(result.app_store_links).toEqual(["play.google.com/store/apps"]);
  });

  it("does not treat WhatsApp links as chat widgets", () => {
    const html = `
      <html><body>
        <a href="https://wa.me/59899123456">WhatsApp</a>
        <a href="https://api.whatsapp.com/send?phone=59899123456">WhatsApp API</a>
      </body></html>
    `;
    const result = parseOperationalSystems(html);
    expect(result.chat_widget).toBe(false);
    expect(result.whatsapp_web_link).toBe(true);
  });

  it("detects known chat widget platforms in scripts and hrefs", () => {
    const platforms = [
      '<script src="https://widget.intercom.io/widget/app"></script>',
      '<script src="https://client.crisp.chat/l.js"></script>',
      '<script src="https://code.tidio.co/test.js"></script>',
      '<script src="https://cdn.livechatinc.com/tracking.js"></script>',
      '<script src="https://example.zendesk.com/embeddable_framework/main.js"></script>',
      '<a href="https://wchat.freshchat.com/js/widget.js">Chat</a>',
    ];

    for (const snippet of platforms) {
      expect(parseOperationalSystems(`<html><body>${snippet}</body></html>`).chat_widget).toBe(true);
    }
  });

  it("detects restaurant menu and delivery/reservation platforms", () => {
    const html = `
      <html><body>
        <a href="/assets/menu-carta.pdf">Ver carta</a>
        <a href="https://www.pedidosya.com.uy/restaurantes/test">Delivery</a>
        <a href="https://reservando.uy/restaurante/test">Reservas</a>
        <p>Escanear QR para ver menu</p>
      </body></html>
    `;
    const result = parseOperationalSystems(html);
    expect(result.menu_links).toEqual(["/assets/menu-carta.pdf"]);
    expect(result.menu_keywords).toEqual(expect.arrayContaining(["ver carta", "escanear qr"]));
    expect(result.delivery_platforms).toEqual(["pedidosya.com"]);
    expect(result.reservation_platforms).toEqual(["reservando.uy"]);
  });

  it("detects custom delivery platforms", () => {
    const html = `
      <html><body>
        <a href="https://delivery-custom.uy/restaurante/test">Delivery</a>
      </body></html>
    `;

    const result = parseOperationalSystems(html, {
      deliveryPlatforms: ["delivery-custom.uy"],
    });

    expect(result.delivery_platforms).toEqual(["delivery-custom.uy"]);
  });

  it("keeps default parsing when ctx is omitted", () => {
    const html = `
      <html><body>
        <a href="https://www.pedidosya.com.uy/restaurantes/test">Delivery</a>
      </body></html>
    `;

    expect(parseOperationalSystems(html).delivery_platforms).toEqual(["pedidosya.com"]);
  });

  it("detects class booking platforms and car dealer catalog/contact form signals", () => {
    const html = `
      <html><body>
        <a href="https://mindbody.io/classes/test">Clases</a>
        <p>Catálogo de usados 0km con kilometraje actualizado.</p>
        <form class="contact-form"><input name="cotizar"></form>
      </body></html>
    `;
    const result = parseOperationalSystems(html);
    expect(result.class_booking_platforms).toEqual(["mindbody.io"]);
    expect(result.catalog_keywords).toEqual(expect.arrayContaining(["catálogo", "0km", "usados", "kilometraje"]));
    expect(result.contact_form).toBe(true);
  });

  it("returns empty signals for plain HTML", () => {
    const result = parseOperationalSystems("<html><body><p>Hola mundo</p></body></html>");
    expect(result).toEqual({
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
    });
  });

  it("detects MercadoPago e-commerce script", () => {
    const html = `<html><body>
      <script src="https://sdk.mercadopago.com/integrations/v1/web-payment-checkout.js"></script>
    </body></html>`;
    expect(parseOperationalSystems(html).ecommerce_platforms).toEqual(
      expect.arrayContaining(["mercadopago.com/integrations"])
    );
  });

  it("detects WhatsApp Business link as whatsapp_web_link", () => {
    const html = `<html><body>
      <a href="https://wa.me/59899123456">Escribinos</a>
    </body></html>`;
    expect(parseOperationalSystems(html).whatsapp_web_link).toBe(true);
  });
});
