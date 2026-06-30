/** Turn a menu name into a URL slug, e.g. "Weekend Brunch" → "weekend-brunch". */
export function menuSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "menu"
  );
}
