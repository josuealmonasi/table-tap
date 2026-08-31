/**
 * Escape text for safe interpolation into an HTML string.
 *
 * Both places that need this build a document for a print window by hand, and
 * both interpolate text a person typed — a restaurant name, a table label, a
 * staff email. React is not escaping any of it there, so this is the only thing
 * standing between a `<script>` in a table label and a print window that runs
 * it. Shared rather than copied: a second, subtly different copy of an escaper
 * is how one of them ends up missing a case.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
