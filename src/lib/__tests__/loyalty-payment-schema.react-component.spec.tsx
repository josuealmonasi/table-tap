import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const trigger = schema.slice(schema.indexOf("create or replace function public.stamp_loyalty_on_payment()"),
  schema.indexOf("for each row execute function public.stamp_loyalty_on_payment();") + "for each row execute function public.stamp_loyalty_on_payment();".length);
const contracts = [
  { name: "fires on insert already paid", pattern: /create trigger stamp_loyalty_on_payment after insert or update of paid on orders/,
    from: "after insert or update of paid", to: "after update of paid" },
  { name: "fires on paid false to true only", pattern: /not new\.paid[\s\S]*tg_op = 'UPDATE' and old\.paid/,
    from: "or (tg_op = 'UPDATE' and old.paid)", to: "" },
  { name: "never stamps cancelled orders", pattern: /new\.status = 'cancelled'/,
    from: "or new.status = 'cancelled'", to: "" },
  { name: "uses the sitting card when the order has none", pattern: /coalesce\(new\.loyalty_card_id,\s*\(select s\.loyalty_card_id from table_sessions s where s\.id = new\.session_id and s\.restaurant_id = new\.restaurant_id\)\)/,
    from: "select s.loyalty_card_id from table_sessions", to: "select null from table_sessions" },
  { name: "records once per card and restaurant-local day", pattern: /now\(\) at time zone[\s\S]*'payment'\)[\s\S]*on conflict on constraint loyalty_visits_card_id_visit_day_key do nothing/,
    from: "on conflict on constraint loyalty_visits_card_id_visit_day_key do nothing", to: "" },
  { name: "refuses an off program or a foreign card", pattern: /not public\.loyalty_open\(new\.restaurant_id\)[\s\S]*c\.id = v_card and c\.restaurant_id = new\.restaurant_id/,
    from: "c.id = v_card and c.restaurant_id = new.restaurant_id", to: "c.id = v_card" },
];
for (const contract of contracts) {
  it(contract.name, () => expect(trigger).toMatch(contract.pattern));
  it(`in-memory plant rejected: ${contract.name}`, () => {
    const planted = trigger.replace(contract.from, contract.to);
    expect(planted).not.toBe(trigger);
    expect(() => expect(planted).toMatch(contract.pattern)).toThrow();
  });
}
