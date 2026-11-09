import { describe, expect, it } from "vitest";
import { statementMail } from "@/lib/account-mail";
import type { Statement } from "@/lib/accounts-server";
import { formatMoney } from "@/lib/format";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

const at = "2026-10-29T01:00:00Z";
const empty: Statement = { days: [], payments: [], returns: [], chargedBy: {}, owed: 0, balances: [] };
function mail(statement: Statement, locale: Locale) {
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor(locale), key, vars);
  return { ...statementMail(statement, {
    restaurant: '<Place & "Co">', name: "<Guest>", currency: "MXN", locale,
    link: 'https://tabletap.test/cuenta/code?x=1&y="two"', timeZone: "America/Mexico_City",
  }, t), t };
}

describe.each<Locale>(["en", "es"])("statement mail in %s", locale => {
  it("includes the screen's payment and return history in text and HTML", () => {
    const { text, html, t } = mail({ ...empty,
      payments: [
        { at, amount: 120, tip: 10, method: "cash", currency: "MXN" },
        { at, amount: 20, tip: 0, method: "card", currency: "USD" },
        { at, amount: 9, tip: 0, method: "card" },
      ],
      returns: [
        { id: "r1", amount: 30, currency: "MXN", status: "completed", created_at: at },
        { id: "r2", amount: 5, currency: "USD", status: "pending", created_at: at },
      ],
    }, locale);
    for (const output of [text, html]) {
      for (const key of ["account.paidBefore", "account.byCash", "account.byCard", "returns.title", "returns.completed", "returns.pending", "attribution.currencyUnknown"]) {
        expect(output).toContain(t(key));
      }
      for (const [amount, currency] of [[120, "MXN"], [20, "USD"], [30, "MXN"], [5, "USD"]] as const) {
        expect(output).toContain(formatMoney(amount, currency));
      }
      expect(output).toContain("9.00");
    }
  });

  it("prints an explicit zero balance after the last debt is paid", () => {
    const { text, html, t } = mail(empty, locale);
    const owed = t("account.mailOwed", { amount: formatMoney(0, "MXN") });
    expect(text).toContain(owed);
    expect(html).toContain(owed);
    expect(html).not.toContain("<h3");
  });

  it("keeps each debt currency instead of treating a mixed balance as zero", () => {
    const { text, t } = mail({ ...empty, balances: [{ currency: "USD", amount: 20 }, { currency: "MXN", amount: 100 }] }, locale);
    expect(text).toContain(t("account.mailOwed", { amount: `${formatMoney(20, "USD")} · ${formatMoney(100, "MXN")}` }));
  });

  it("escapes names, extras, return labels and the link in HTML", () => {
    const { text, html } = mail({ ...empty, owed: 10, balances: undefined,
      days: [{ day: "2026-10-28", total: 10, charges: [{ orderId: "o", at, total: 10, tableLabel: null,
        lines: [{ name: "<Dish>", extras: ['<Note & "extra">'], qty: 1, amount: 10, emoji: null }],
      }] }],
      returns: [{ id: "r", amount: 1, currency: "MXN", status: '<script>"&', created_at: at }],
    }, locale);
    expect(text).toContain("<Dish>");
    for (const raw of ["<Place", "<Guest>", "<Dish>", "<Note", "<script>"]) expect(html).not.toContain(raw);
    for (const safe of ["&lt;Place &amp; &quot;Co&quot;&gt;", "&lt;Guest&gt;", "&lt;Dish&gt;", "&lt;Note &amp; &quot;extra&quot;&gt;", "&lt;script&gt;&quot;&amp;"]) expect(html).toContain(safe);
    expect(html).toContain('href="https://tabletap.test/cuenta/code?x=1&amp;y=&quot;two&quot;"');
  });
});
