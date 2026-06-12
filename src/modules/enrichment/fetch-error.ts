// Clasificación de fetch_error para el tag `site-unreachable`.
//
// `isPermanentFetchError` (en index.ts) decide si CACHEAR el error (no reintentar).
// Esta función responde una pregunta DISTINTA: ¿el sitio realmente NO existe / no es
// usable para un cliente? Solo entonces corresponde `site-unreachable`.
//
// Diferencia clave con isPermanentFetchError:
//   - 403 (bot-block): para el cache es "permanente", pero el sitio EXISTE y funciona
//     para un humano → NO es site-unreachable (nos bloquearon a nosotros, no al cliente).
//   - timeouts / 5xx / 429 / network: transitorios → el sitio probablemente existe.
//   - non-html-content: la URL devuelve algo (PDF, etc.) → el sitio existe.
//
// Solo 404 / 410 (gone) / invalid-domain significan "no hay sitio usable".
export function isWebsiteGenuinelyMissing(error: string | null | undefined): boolean {
  if (!error) return false;
  if (error === "invalid-domain") return true;
  const m = /^http-(\d{3})$/.exec(error);
  if (m) {
    const code = Number(m[1]);
    return code === 404 || code === 410;
  }
  return false;
}
