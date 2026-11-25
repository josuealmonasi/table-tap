import { expect, it } from "vitest";
import { readDigestFigures } from "../digest-figures";
import { digestMail } from "../digest-mail";
import type { RecoveryContext } from "../job";

const restaurant = { restaurant_id: "r", currency: "MXN", timezone: "America/Tijuana", digest_day: "2026-11-01" };
const now = new Date("2026-11-02T15:00:00Z");
const start = "2026-11-01T07:00:00.000Z";
const end = "2026-11-02T08:00:00.000Z";
const common = { restaurant_id: "r", currency: "MXN" };
const date = { created_at: start };
const line = (name: string, price: number, qty: number) => ({ name, itemId: name, price, qty });
const sale = { ...common, ...date, paid: true, status: "completed", checkout_discount_at: null,
  table_id: null, table_label: null as string | null, service_fee: 0, tip: 0, items: [], total: 10 };
const debt = { ...sale, paid: false, written_off: false, charged_at: null };
const stockout = { ...common, ...date, item_id: "1", name: "Mezcal <joven>" };
const orderRows = [
  { ...sale, id: "a", total: 80, tip: 5, table_label: "Removed table", items: [line("Tacos", 20, 3), line("Agua", 10, 2)],
    promo_detail: { item: 5, promos: 10 } },
  { ...sale, id: "b", created_at: "2026-11-02T07:59:59.999Z", total: 35, items: [line("Tacos", 20, 1), line("Pan", 10, 1), line("Flan", 5, 1)] },
  { ...sale, id: "prev", created_at: "2026-10-25T07:00:00.000Z", total: 100 },
  { ...sale, id: "end", created_at: end, total: 900 },
  { ...sale, id: "cancelled", status: "cancelled", total: 800 },
  { ...sale, id: "other-currency", currency: "USD", total: 700 },
  { ...sale, id: "other-restaurant", restaurant_id: "other", total: 600 },
  { ...debt, id: "debt-1", account_id: "open", total: 10.25 },
  { ...debt, id: "debt-2", account_id: "open", total: 12.75 },
  { ...debt, id: "debt-3", account_id: "open", currency: "USD", total: 3 },
  { ...debt, id: "debt-4", account_id: "closed", total: 500 },
  { ...debt, id: "debt-5", account_id: "open", total: 400, written_off: true },
];
const event = { ...common, succeeded_at: start, kind: "return", operation_id: "refund-1", amount_cents: 200 };
const tables = {
  payments: [
    { ...common, ...date, actor_email: null, amount: 50, method: "card" },
    { ...common, ...date, actor_email: "till", amount: 15, method: "card" },
    { ...common, ...date, actor_email: "till", amount: 50, method: "cash" },
    { ...common, created_at: end, actor_email: "till", amount: 700, method: "cash" },
  ],
  order_adjustments: [{ ...common, kind: "return", order_id: "a", previous_total: 95, resulting_total: 80,
    previous_tip: 5, resulting_tip: 5, previous_service_fee: 0, resulting_service_fee: 0 }],
  order_return_events_v1: [
    { ...event, id: "return-1" },
    { ...event, id: "return-2", amount_cents: 300 },
    { ...event, id: "return-3", operation_id: "refund-2", kind: "cancel", amount_cents: 1000 },
    { ...event, id: "return-4", succeeded_at: end },
  ],
  coupon_redemptions: [{ ...common, order_id: "a", amount: 5, confirmed_at: start }],
  customer_accounts: [{ ...common, id: "open", status: "open" }, { ...common, id: "closed", status: "closed" }],
  discount_requests: [{ ...common, status: "pending" }, { ...common, status: "approved" }],
  write_off_requests: [{ ...common, status: "pending" }, { ...common, status: "pending" }],
  offline_sale_queue: [
    { ...common, approved_at: null, resolved_at: null }, { ...common, approved_at: start, resolved_at: null },
    { ...common, approved_at: null, resolved_at: start },
  ],
  refunds_due: [{ ...common, refunded_at: null }, { ...common, refunded_at: start }],
  menu_stockouts: [
    stockout, stockout, { ...stockout, item_id: "2", name: "Pan" },
    { ...stockout, created_at: end, item_id: "3", name: "After midnight" },
  ],
} satisfies Record<string, Record<string, unknown>[]>;

function fixture(orders = orderRows) {
  const data: Record<string, Record<string, unknown>[]> = { orders, ...tables };
  const reads: string[] = [];
  function query(table: string, initial = data[table]) {
    reads.push(table);
    if (!initial) throw new Error(`Unexpected table ${table}`);
    let rows = [...initial];
    function filter(key: string, test: (value: unknown) => boolean) {
      rows = rows.filter(r => test(r[key]));
      return q;
    }
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => filter(key, v => v === value),
      neq: (key: string, value: unknown) => filter(key, v => v !== value),
      is: (key: string, value: unknown) => filter(key, v => v === value),
      not: (key: string, _op: string, value: unknown) => filter(key, v => v != null && v !== value),
      in: (key: string, values: unknown[]) => filter(key, v => values.includes(v)),
      gte: (key: string, value: string) => filter(key, v => typeof v === "string" && v >= value),
      lt: (key: string, value: string) => filter(key, v => typeof v === "string" && v < value),
      range: (from: number, to: number) => { page = [from, to + 1]; return q; },
      then: (resolve: (value: unknown) => void) => resolve({ data: rows.slice(...page), count: rows.length, error: null }),
    };
    let page: [number, number?] = [0];
    return q;
  }
  const db = { from: query, rpc: (name: string, filters: { p_restaurant: string; p_currency: string }) =>
    query(name).eq("restaurant_id", filters.p_restaurant).eq("currency", filters.p_currency) } as unknown as RecoveryContext["db"];
  return { db, reads };
}

it("uses Analytics and Accounts figures within a 25-hour local day and keeps currencies separate", async () => {
  const { db } = fixture();
  const figures = await readDigestFigures(db, restaurant, now);
  expect(figures).toMatchObject({
    day: new Date(start), sales: 125, salesChange: 25, count: 2, avgTicket: 62.50, dineIn: 1, toGo: 1,
    card: 65, cash: 50, tips: 5, discounts: 20, refunds: { count: 2, amount: 15 },
    attention: { discounts: 1, writeOffs: 2, offline: 1, due: 1,
      accounts: { count: 1, balances: [{ amount: 23, currency: "MXN" }, { amount: 3, currency: "USD" }] },
      stockouts: ["Mezcal <joven>", "Pan"] },
  });
  expect(figures?.dishes.map(({ name, qty }) => [name, qty])).toEqual([["Tacos", 4], ["Agua", 2], ["Pan", 1]]);
});

it("skips zero revenue without reading the register or attention queues", async () => {
  const { db, reads } = fixture([{ ...sale, id: "comp", total: 0 }]);
  await expect(readDigestFigures(db, restaurant, now)).resolves.toBeNull();
  expect(new Set(reads)).toEqual(new Set(["orders", "order_adjustments"]));
});

it.each([
  ["en", "How yesterday went", "Needs your attention", "vs. last Sunday", "you opted in as a manager"],
  ["es", "Así te fue ayer", "Necesita tu atención", "vs. el domingo pasado", "eres dueño de"],
] as const)("renders the approved sections, links and readable figures in %s", async (locale, title, attention, compare, footer) => {
  const { db } = fixture();
  const figures = await readDigestFigures(db, restaurant, now);
  if (!figures) throw new Error("Expected digest figures");
  const mail = digestMail(figures, { ...restaurant, name: "Bistro <Demo>", locale, owner: locale === "es",
    dashboard: "https://test/dashboard", stop: "https://test/digest/opt-out", oneClick: "https://test/api/digest/opt-out" });
  expect(mail.subject).toContain(title);
  for (const text of [attention, compare, footer, "MX$125", "MX$23 · $3", "https://test/digest/opt-out", "Tacos"]) {
    expect(mail.html).toContain(text);
    expect(mail.text).toContain(text);
  }
  expect(mail.html).toContain("Bistro &lt;Demo&gt;");
  expect(mail.html).toContain("Mezcal &lt;joven&gt;");
  expect(mail.headers).toEqual({
    "List-Unsubscribe": "<https://test/api/digest/opt-out>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
});
