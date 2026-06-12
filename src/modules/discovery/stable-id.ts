// N8.2 — external_id ESTABLE derivado de campos de negocio. El `_id` del datastore
// CKAN es un row-id autoincremental: una republicación del dataset upstream lo
// reordena y el upsert por (source, external_id) re-insertaría todo el padrón como
// nuevo. Nota en SCHEMA.md: el _id de CKAN NO es estable.
import { createHash } from "node:crypto";

function normalizePart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Hash determinístico (16 hex) de partes de identidad del negocio, normalizadas. */
export function stableBusinessId(parts: ReadonlyArray<unknown>): string {
  const key = parts.map(normalizePart).join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}
