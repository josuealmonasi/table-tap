import { describe, expect, it } from "vitest";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { ticketMail } from "@/lib/ticket-mail";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

const order: ReceiptOrder = { id: "1960abcd-1234-4567-89ab-cdef01234567", created_at: "2026-11-10T18:13:00Z", currency: "MXN", subtotal: 10, tip: 2, total: 12, table_label: null, items: [{ itemId: "a", name: "Tea", emoji: "", price: 10, qty: 1, mods: {} }] };

describe.each<Locale>(["en", "es"])("ticket email HTML in %s", locale => {
  it("keeps the card footer inside the receipt without an empty paragraph and uses Counter colors", () => {
    const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor(locale), key, vars);
    const receipt = buildReceipt([order], { name: "Demo", timeZone: "UTC", locale }, t);
    const html = ticketMail(receipt, { receiptFooter: t("receipt.footer"), footer: t("cardEmail.footer", { restaurant: "Demo" }), stopLabel: t("cardEmail.stopLink"), stop: "https://example.com/tickets/stop?t=token" }).html;
    expect(html).not.toMatch(/<p[^>]*>\s*<\/p>/);
    expect(html).toMatch(/<a[^>]*>[^<]+<\/a><\/p>\s*<\/div>$/);
    expect(html).not.toMatch(/#16211c|#6e7a74|#e3e2dc/i);
    expect(html).toContain("#111113");
    expect(html).toContain("#70707a");
    expect(html).toContain("#e6e6e9");
    expect(html).toContain("#0e6e6e");
    expect(html.replace(/(2026) (?:a las|at) /g, "$1, ")).toMatchSnapshot();
  });
});
