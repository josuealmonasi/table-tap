import React from "react";

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ItemDetailScreen from "../ItemDetailScreen";
import { LocaleProvider } from "@/lib/i18n/context";
import type { MenuItem, OrderLineItem } from "@/lib/types";
import type { CartPromo } from "@/lib/pricing";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.stubGlobal("React", React);


const item = { id: "rice", name: "Rice", emoji: "", price: 3, modifiers: [], dietary: [] } as unknown as MenuItem;
const promo: CartPromo = { id: "deal", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["rice"] };

const rice = (qty: number): OrderLineItem =>
  ({ itemId: "rice", name: "Rice", emoji: "", price: 3, qty, mods: {}, extras: [] }) as OrderLineItem;

function screen(qty: number, locale: "en" | "es", otherQty = 0): string {
  const others = otherQty ? [rice(otherQty)] : [];
  return renderToStaticMarkup(<LocaleProvider locale={locale}><ItemDetailScreen item={item} extras={[]} currency="MXN"
    onBack={() => {}} onAdd={() => {}} initialLine={rice(qty)} cartLines={others} promos={[promo]} /></LocaleProvider>);
}

describe("dish deal callout and price", () => {
  it.each(["en", "es"] as const)("matches the selected quantity in %s", locale => {
    const one = screen(1, locale);
    expect(one).toContain(locale === "en" ? "Add 1 more" : "Agrega 1 más");
    expect(one).toContain("MX$3.00</span></button>");
    expect(one).not.toContain('<s class="tt-was">');
    for (const qty of [2, 3]) {
      const html = screen(qty, locale);
      expect(html).toContain(locale === "en" ? "Applied" : "Aplicado");
      expect(html).toContain(qty === 2 ? '<s class="tt-was">MX$6.00</s>MX$3.00' : '<s class="tt-was">MX$9.00</s>MX$6.00');
      expect(html).not.toContain(locale === "en" ? "Add 2 more" : "Agrega 2 más");
    }
  });
  it("counts other cart lines when the selected dish completes the deal", () => {
    const html = screen(1, "en", 1);
    expect(html).toContain("Applied");
    expect(html).toContain('<s class="tt-was">');
  });
});
