// Fixtures GPS reales tomados de la DB (R.3 del plan de remediación).
// El hex es el formato EWKB que PostGIS devuelve por ST_AsEWKB/columnas geometry:
// Point little-endian + SRID 4326. Verificado contra la DB con:
//   SELECT ST_AsText('0101000020E610000039C8900832FA4CC0A79DF58480633FC0'::geometry);
//   -> POINT(-57.9546519 -31.3886798)
//
// parseLeadGps hoy NO decodifica este formato (devuelve null) — ver F2.1.

export interface GpsFixture {
  /** Hex EWKB tal como lo devuelve la DB. */
  hex: string;
  /** Coordenadas esperadas tras decodificar. */
  expected: { lng: number; lat: number };
}

/** Caso real verificado contra la DB (Paysandú). */
export const EWKB_POINT_PAYSANDU: GpsFixture = {
  hex: "0101000020E610000039C8900832FA4CC0A79DF58480633FC0",
  expected: { lng: -57.9546519, lat: -31.3886798 },
};

/** Formato legible que parseLeadGps SÍ soporta hoy (regresión: debe seguir andando). */
export const POINT_TEXT_PAYSANDU = {
  text: "POINT(-57.9546519 -31.3886798)",
  expected: { lng: -57.9546519, lat: -31.3886798 },
} as const;

/** Tolerancia para comparar floats decodificados de WKB. */
export const GPS_EPSILON = 1e-7;
