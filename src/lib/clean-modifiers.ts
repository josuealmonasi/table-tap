import type { Modifier } from "@/lib/types";

/**
 * The option groups a product is saved with: only those that actually have a
 * name and choices, trimmed.
 *
 * Every field the group carries has to be listed here — this rebuilds the
 * object rather than spreading it, so anything omitted is silently dropped on
 * save. `required` was, which meant a manager could tick the box, save, and
 * the customer would still be able to add without choosing.
 */
export function cleanModifiers(groups: Modifier[]): Modifier[] {
  return groups
    .map(g => ({
      label: g.label.trim(),
      type: g.type,
      options: g.options.map(o => o.trim()).filter(Boolean),
      // Written only when true, so groups that don't need it stay clean in
      // the stored JSON.
      ...(g.required ? { required: true } : {}),
    }))
    .filter(g => g.label && g.options.length > 0);
}
