import { describe, expect, it } from "vitest";
import { ticketMail } from "@/lib/ticket-mail";
import { statementMail } from "@/lib/account-mail";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

// Intl's date-time joiner differs by ICU version (es-MX: ", " vs " a las ";
// en-US: ", " vs " at "): CI's Node is newer than a laptop's. The layout is
// what this spec pins, so the snapshot sees one joiner whatever the runtime.
const stableDate = (text: string): string => text.replace(/(\d{4}) (?:a las|at) /g, "$1, ");

const link = "https://tabletap.test/cuenta/code";
const at = "2026-11-10T18:13:00Z";
const place = { name: "Demo Bistro", timeZone: "America/Mexico_City" };
const order: ReceiptOrder = {
  id: "1960abcd-1234-4567-89ab-cdef01234567", created_at: at, currency: "MXN",
  subtotal: 250, total: 250, table_label: "6",
  items: [
    { itemId: "a", name: "Apple Pie", emoji: "", price: 200, qty: 1, mods: {} },
    { itemId: "b", name: "Tea", emoji: "", price: 50, qty: 1, mods: {} },
  ],
};

describe.each<Locale>(["en", "es"])("plain-text emails in %s", locale => {
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor(locale), key, vars);

  it("separates statement days, dishes, balance and payment link", () => {
    const mail = statementMail({ owed: 500, payments: [], returns: [], chargedBy: {},
      days: ["2026-11-10", "2026-11-11"].map(day => ({ day, total: 250, charges: [{
        orderId: day, at, total: 250, tableLabel: null,
        lines: [
          { name: "Apple Pie", extras: [], qty: 1, amount: 200, emoji: null },
          { name: "Tea", extras: [], qty: 1, amount: 50, emoji: null },
        ],
      }] })),
    }, { ...place, restaurant: place.name, name: "Ana", currency: "MXN", link, locale }, t);
    const blocks = mail.text.split("\n\n");
    expect(blocks).toHaveLength(5);
    expect(blocks.slice(1, 3).map(block => block.split("\n").length)).toEqual([3, 3]);
    expect(mail.text.split("\n").at(-1)).toBe(link);
    expect(stableDate(mail.text)).toMatchSnapshot();
  });

  it("separates POS and diner receipt paragraphs and keeps each item and total on one line", () => {
    const mail = buildReceipt([order], { ...place, locale: locale === "es" ? "es-MX" : "en-US" }, t);
    const blocks = mail.text.split("\n\n");
    expect(blocks).toHaveLength(5);
    expect(blocks[1].split("\n")).toEqual(["1× Apple Pie  MX$200.00", "1× Tea  MX$50.00"]);
    expect(blocks[2]).toBe(`${t("totals.total")}  MX$250.00`);
    expect(stableDate(mail.text)).toMatchSnapshot();
  });
  it("separates card ticket paragraphs and puts the unsubscribe link on its own line", () => {
    const receipt = buildReceipt([order], { ...place, locale: locale === "es" ? "es-MX" : "en-US" }, t);
    const stop = "https://tabletap.test/tickets/stop?t=token";
    const mail = ticketMail(receipt, { receiptFooter: t("receipt.footer"),
      footer: t("cardEmail.footer", { restaurant: place.name }), stopLabel: t("cardEmail.stopLink"), stop });
    expect(mail.text).not.toContain(t("receipt.footer"));
    expect(mail.text).toContain("1× Apple Pie  MX$200.00\n1× Tea  MX$50.00\n\n");
    expect(mail.text.split("\n").slice(-2)).toEqual([`${t("cardEmail.stopLink")}:`, stop]);
    expect(mail.text).not.toMatch(/\n{3}/);
    expect(stableDate(mail.text)).toMatchSnapshot();
  });

  it("keeps the receipt header together when a counter sale has no table", () => {
    const mail = buildReceipt([{ ...order, table_label: null }], { ...place, locale }, t);
    expect(mail.text.split("\n\n")[0].split("\n")).toHaveLength(3);
  });

});
