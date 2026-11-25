/** PostgreSQL accepts braces and optional hyphens between groups of four digits. */
export function canonicalReceiptId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 41) return null;
  const id = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  if (!/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(id)) return null;
  return id.replaceAll("-", "").toLowerCase()
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
