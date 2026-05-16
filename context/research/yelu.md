# Yelu.uy — Research

**Fuente:** directorio privado uruguayo. ~31k listings. Sin API pública.
**Acceso:** scraping HTML. Sin autenticación. Rate limits no documentados — usar delays entre páginas.

---

## URL structure

- Listado pág. 1: `https://www.yelu.uy/category/{Category}/city:{citySlug}`
- Listado pág. N: `https://www.yelu.uy/category/{Category}/{N}/city:{citySlug}`
- Perfil empresa: `https://www.yelu.uy/company/{cmpid}/{slug}`

## Datos disponibles (listado)

Nombre, dirección, teléfono. No GPS. No website. No email.

## Datos adicionales (perfil)

Website externo, email — ya explotados en `src/modules/enrichment/directory-discovery.ts` durante enrichment.

## HTML selectors (verificados en código)

- Empresa: `div.company[data-cmpid]`
- Nombre: `h3 > a`
- Dirección: `div.address`
- Teléfono: `div.s` con `i.fa-phone` → `span` (primera)

## Categorías disponibles

| Niche | Slug Yelu |
|-------|-----------|
| restaurant | Restaurantes |
| gym | Gimnasios |
| hairdresser | Peluqueros |
| car_dealer | Concesionarios_de_Autos |
| accommodation | Hoteles |
| pharmacy | Farmacias |
| grocery | Supermercados |
| dentist | Dentistas |
| healthcare | Medicos |

## Integración existente

`src/modules/enrichment/directory-discovery.ts` usa yelu.uy para matching 1:1 durante enrichment (fetch del perfil individual para obtener website/email). `YeluProvider` es la contraparte de discovery masivo — no importa de `directory-discovery.ts` para evitar acoplamiento entre capas.

## Confianza base

0.65 — directorio privado, datos pueden estar desactualizados. No tiene GPS ni email en el listado.
