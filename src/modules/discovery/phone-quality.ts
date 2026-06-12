// F5.3 — Calidad de teléfonos. Dos clases de basura verificadas en la DB:
//   1. Placeholders: '0', '0000000', o menos de 7 dígitos → no es un teléfono uruguayo.
//   2. Genéricos: un mismo número compartido por >N leads (ej. '24070000' en 52 leads DEI
//      es el teléfono del gestor/contador, no del negocio).
import { z } from "zod";

/** Mínimo de dígitos de un teléfono uruguayo válido (fijos de 8, móviles de 9; 7 como piso). */
const MIN_PHONE_DIGITS = 7;

export const TrustedPhoneSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => digits.length >= MIN_PHONE_DIGITS, { message: "menos de 7 dígitos" })
  .refine((digits) => !/^0+$/.test(digits), { message: "placeholder ^0+$" });

/** ¿El phone es basura de ingest (placeholder o demasiado corto)? null/vacío NO es junk. */
export function isJunkPhone(phone: string | null | undefined): boolean {
  if (typeof phone !== "string" || phone.trim() === "") return false;
  return !TrustedPhoneSchema.safeParse(phone).success;
}

/** Si el phone es basura lo anula; si no, lo devuelve intacto. */
export function scrubJunkPhone(phone: string | null): string | null {
  return isJunkPhone(phone) ? null : phone;
}

/**
 * Phones (normalizados a dígitos) compartidos por MÁS de `threshold` entradas:
 * números genéricos de gestor/institución, no identidad del negocio.
 */
export function findGenericSharedPhones(
  phones: ReadonlyArray<string | null | undefined>,
  threshold: number
): Set<string> {
  const counts = new Map<string, number>();
  for (const phone of phones) {
    if (typeof phone !== "string") continue;
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 0) continue;
    counts.set(digits, (counts.get(digits) ?? 0) + 1);
  }
  const generic = new Set<string>();
  for (const [digits, count] of counts) {
    if (count > threshold) generic.add(digits);
  }
  return generic;
}
