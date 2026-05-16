# PedidosYa Uruguay — Research

**Fuente:** marketplace de delivery dominante en Uruguay. Sin API pública.  
**Acceso:** scraping Playwright (SPA React — requiere JS rendering). Sin autenticación.  
**Investigación:** Playwright exploratorio en 2026-05-15.

---

## URL structure

- Listado pág. 1: `https://www.pedidosya.com.uy/restaurantes/{citySlug}`
- Listado pág. N: `https://www.pedidosya.com.uy/restaurantes/{citySlug}?page={n}`
- Perfil restaurante: `/restaurantes/{city}/{slug}-{uuid}-menu` o `/restaurantes/{city}/{slug}-menu`
- Total páginas Montevideo: ~46 (20 items/página)

## Datos disponibles (listado)

Nombre, listing_url. No dirección. No GPS. No teléfono. No email. No categoría de comida.

## Campos NO disponibles en listing

- `expedition_type` (delivery/pickup): no distinguible a nivel listing. Toda la plataforma es delivery → se setea `"delivery"` por defecto.
- `address`: no expuesto en el card del listado.
- `category` de comida (pizza, burger, etc.): no expuesto.

## HTML structure (React SPA — clases CSS son dinámicas/inestables)

- Lista de restaurantes: `<ul> > <li>`
- Link de restaurante: `<a href="/restaurantes/{city}/{slug}-menu" aria-label="Ir al restaurante {name}">`
- **Selector estable:** `a[href*="/{citySlug}/"][href$="-menu"]`
- **Nombre:** `a.getAttribute('aria-label').replace('Ir al restaurante ', '')` — aria-label es estable
- **Paginación:** nav con `aria-label="Paginación"`, links con `?page={n}`
- **external_id:** UUID v4 en href cuando existe (`[0-9a-f-]{36}`); si no, slug completo antes de `-menu`

### Ejemplo URL con UUID
```
/restaurantes/montevideo/madre-mia--tres-cruces-1c033c2d-b8fe-4e99-ac2a-2c0f866e2ba1-menu
→ external_id: 1c033c2d-b8fe-4e99-ac2a-2c0f866e2ba1
```

### Ejemplo URL sin UUID (cadenas grandes)
```
/restaurantes/montevideo/starbucks-la-espanola-menu
→ external_id: starbucks-la-espanola
```

## Categorías de PedidosYa (URL paths)

| Niche | URL path |
|-------|---------|
| restaurant | `/restaurantes/{city}` |
| pharmacy | `/farmacias/{city}` (no implementado) |
| grocery | `/supermercados/{city}` (no implementado) |

Solo `restaurant` → `restaurantes` implementado en Fase 10. Otras categorías pueden agregarse en fases futuras.

## Señal de delivery

Todos los negocios listados en PedidosYa tienen delivery activo. La señal es la **presencia en la plataforma**, no un campo explícito.  
→ Alimenta `inferred_state.has_delivery = { value: true, confidence: 0.95, via: ['pedidosya'] }`.

## Implementación

`src/modules/discovery/providers/pedidosya.ts` — `PedidosYaProvider: IDiscoveryProvider`
- MAX_PAGES = 5 (conservador — Playwright costoso en RAM)
- sourceConfidence = 0.70
- Browser único por llamada a `discover()` — múltiples páginas reusan el mismo browser
