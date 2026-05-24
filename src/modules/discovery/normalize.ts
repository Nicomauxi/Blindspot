export function normalizeLocationKey(location: string): string {
  return location
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/,.*$/, "")
    .trim();
}
