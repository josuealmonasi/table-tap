import { createHash } from "node:crypto";
import { capName, capNote } from "@/lib/notes";
import { checkoutTip } from "@/lib/checkout/checkout-body";
import type { OrderLineItem } from "@/lib/types";

interface OrderRequest {
  items?: OrderLineItem[];
  tableId?: string | null;
  couponCode?: string;
  tipPct?: number;
  tipAmount?: number;
  note?: string;
  customerName?: string;
  accountId?: string;
  method?: string;
}

// Labels, displayed prices and cart ids are not instructions to the kitchen.
// A menu edit must not turn a retry of the same meal into a different request.
function itemsOf(items: OrderLineItem[] = []): object[] {
  return items.map(line => ({
    itemId: line.itemId, qty: line.qty, mods: line.mods ?? {},
    extras: (line.extras ?? []).map(extra => extra.id).sort(), notes: capNote(line.notes) ?? null,
    comboId: line.comboId ?? null,
    components: (line.components ?? []).map(part => ({
      itemId: part.itemId, qty: part.qty, mods: part.mods ?? {},
      extras: (part.extras ?? []).map(extra => extra.id).sort(),
    })),
  }));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The reference names the first requested meal, never a later cart. */
export function orderRequestScope(surface: string, body: OrderRequest): string {
  const tip = body.method === "account" ? { tipPct: 0, tipAmount: null } : checkoutTip(body);
  const request = {
    items: itemsOf(body.items), tableId: body.tableId ?? null,
    couponCode: body.couponCode?.trim().toUpperCase() || null, ...tip,
    note: capNote(body.note) ?? null, customerName: capName(body.customerName) ?? null,
    accountId: body.accountId ?? null, method: body.method ?? null,
  };
  return `${surface}:${createHash("sha256").update(canonical(request)).digest("hex")}`;
}
