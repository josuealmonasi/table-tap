import type { OrderLineItem } from "@/lib/types";

/** Remove both views of a vanished combo upgrade, or the retry asks for it again. */
export function removeLineExtras<T extends OrderLineItem>(line: T, drop: ReadonlySet<string>): T {
  const extras = line.extras?.filter(extra => !drop.has(extra.id));
  const components = line.components?.map(part => {
    const kept = part.extras?.filter(extra => !drop.has(extra.id));
    return { ...part, extras: kept?.length ? kept : undefined };
  });
  return { ...line, extras: extras?.length ? extras : undefined, ...(components ? { components } : {}) };
}
