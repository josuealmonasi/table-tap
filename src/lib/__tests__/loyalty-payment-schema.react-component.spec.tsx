import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const trigger = schema.slice(schema.indexOf("create or replace function public.stamp_loyalty_on_payment()"),
  schema.indexOf("for each row execute function public.stamp_loyalty_on_payment();") + "for each row execute function public.stamp_loyalty_on_payment();".length);
// Payment fixes the sitting's card onto the sale before the row is written,
// so the stamp and every reprint name the same card (Codex review of #620).
const fixer = schema.slice(schema.indexOf("create or replace function public.fix_loyalty_card_on_payment()"),
  schema.indexOf("for each row execute function public.fix_loyalty_card_on_payment();") + "for each row execute function public.fix_loyalty_card_on_payment();".length);
const fixerContracts = [
  { name: "a paid sale takes its sitting's card when it has none", pattern: /new\.loyalty_card_id is null and new\.session_id is not null then\s*new\.loyalty_card_id := \(select s\.loyalty_card_id from table_sessions s\s*where s\.id = new\.session_id and s\.restaurant_id = new\.restaurant_id\)/,
    from: "select s.loyalty_card_id from table_sessions", to: "select null from table_sessions" },
  { name: "fixed before the row is written, on insert or on becoming paid", pattern: /create trigger fix_loyalty_card_on_payment before insert or update of paid on orders/,
    from: "before insert or update of paid", to: "after update of paid" },
  { name: "keeps no card that was not stamped (program off, another restaurant's)", pattern: /not public\.loyalty_open\(new\.restaurant_id\)[\s\S]*c\.id = new\.loyalty_card_id and c\.restaurant_id = new\.restaurant_id\)\) then\s*new\.loyalty_card_id := null/,
    from: "c.id = new.loyalty_card_id and c.restaurant_id = new.restaurant_id", to: "c.id = new.loyalty_card_id" },
];
for (const contract of fixerContracts) {
  it(contract.name, () => expect(fixer).toMatch(contract.pattern));
  it(`in-memory plant rejected: ${contract.name}`, () => {
    const planted = fixer.replace(contract.from, contract.to);
    expect(planted).not.toBe(fixer);
    expect(() => expect(planted).toMatch(contract.pattern)).toThrow();
  });
}
const contracts = [
  { name: "fires on insert already paid", pattern: /create trigger stamp_loyalty_on_payment after insert or update of paid on orders/,
    from: "after insert or update of paid", to: "after update of paid" },
  { name: "fires on paid false to true only", pattern: /not new\.paid[\s\S]*tg_op = 'UPDATE' and old\.paid/,
    from: "or (tg_op = 'UPDATE' and old.paid)", to: "" },
  { name: "never stamps cancelled orders", pattern: /new\.status = 'cancelled'/,
    from: "or new.status = 'cancelled'", to: "" },
  { name: "stamps the card fixed on the sale", pattern: /v_card := new\.loyalty_card_id;/,
    from: "v_card := new.loyalty_card_id;", to: "v_card := null;" },
  { name: "records once per card and restaurant-local day", pattern: /now\(\)\) at time zone[\s\S]*'payment'\)[\s\S]*on conflict on constraint loyalty_visits_card_id_visit_day_key do nothing/,
    from: "on conflict on constraint loyalty_visits_card_id_visit_day_key do nothing", to: "" },
  { name: "an offline sale counts on the day it was rung", pattern: /coalesce\(new\.offline_at, now\(\)\) at time zone/,
    from: "coalesce(new.offline_at, now())", to: "coalesce(now(), now())" },
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
