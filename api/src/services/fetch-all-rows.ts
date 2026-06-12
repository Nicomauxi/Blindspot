// N55 — PostgREST capa toda respuesta a max_rows (1000) aunque se pida limit(5000):
// las agregaciones que creían operar sobre 5000 leads veían solo el 18% más reciente.
// Única forma de traer el set completo: paginar con range().
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
