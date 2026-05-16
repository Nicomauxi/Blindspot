export interface CopyrightYearSignal {
  year: number | null;
  outdated: boolean;
}

export const OUTDATED_YEAR_THRESHOLD = 2020;

const COPYRIGHT_CONTEXT = /(?:©|&copy;|copyright)\s*.{0,80}/gi;
const YEAR = /\b(?:19|20)\d{2}\b/g;

export function parseCopyrightYear(
  html: string,
  threshold = OUTDATED_YEAR_THRESHOLD
): CopyrightYearSignal {
  let year: number | null = null;
  const contexts = html.match(COPYRIGHT_CONTEXT) ?? [];

  for (const context of contexts) {
    const matches = context.match(YEAR) ?? [];
    for (const match of matches) {
      const parsed = Number.parseInt(match, 10);
      if (year === null || parsed > year) year = parsed;
    }
  }

  return {
    year,
    outdated: year !== null && year <= threshold,
  };
}
