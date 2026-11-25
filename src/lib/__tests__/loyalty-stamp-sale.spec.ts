import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

// Review 2026-11-25: loyalty stamps, ticket sends and redemption timing.

const SALE = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  role: "waiter" as string,
  calls: [] as unknown[][],
  logs: [] as { detail?: string | null }[],
  answer: null as unknown,
}));
vi.mock("@/lib/api-guard", () => ({
  actingFrontOfHouse: async () => state.role === "kitchen" ? null : { restaurantId: "r1", role: state.role, email: "staff@example.invalid" },
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ error: key }, { status }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null }) => { state.logs.push(e); } }));
vi.mock("@/lib/loyalty/server", () => ({
  loyaltyOn: async () => true,
  stamp: async (...args: unknown[]) => {
    state.calls.push(args);
    return state.answer ?? { stamped: true, standing: { visits: 1, goal: 2 }, round: 0 };
  },
}));
const { POST } = await import("@/app/api/loyalty/stamp/route");
const send = (body: object) => POST(new NextRequest("http://localhost/api/loyalty/stamp", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => Object.assign(state, { role: "waiter", calls: [], logs: [], answer: null }));

describe("finding 1: a waiter's stamp stands on a sale", () => {
  it.each(["waiter", "cashier"])("refuses a %s with no sale, and stamps nothing", async role => {
    state.role = role;
    const res = await send({ code: "K7QM3XW9TB4R" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "apiErr.stampNeedsSale" });
    expect(state.calls).toEqual([]);
  });

  it("refuses a sale id that is not an id, before the database", async () => {
    expect((await send({ code: "K7QM3XW9TB4R", saleId: "1; drop" })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("passes the waiter's sale to the database and names it in the log", async () => {
    expect((await send({ code: "K7QM3XW9TB4R", saleId: SALE })).status).toBe(200);
    expect(state.calls).toEqual([["r1", "K7QM3XW9TB4R", "staff@example.invalid", SALE]]);
    expect(state.logs[0].detail).toContain("order=");
    expect(state.logs[0].detail).not.toContain("override");
  });

  it.each(["owner", "manager"])("lets a %s stamp with no sale, logged as an override", async role => {
    state.role = role;
    expect((await send({ code: "K7QM3XW9TB4R" })).status).toBe(200);
    expect(state.calls).toEqual([["r1", "K7QM3XW9TB4R", "staff@example.invalid", null]]);
    expect(state.logs[0].detail).toContain("override=no_sale");
  });

  it.each([
    ["saleNotPaid", "apiErr.stampSaleNotPaid"],
    ["saleNotToday", "apiErr.stampSaleNotToday"],
    ["saleUsed", "apiErr.stampSaleUsed"],
  ])("answers the database's %s refusal with 409 and its message, and logs nothing", async (refused, key) => {
    state.answer = { refused };
    const res = await send({ code: "K7QM3XW9TB4R", saleId: SALE });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: key });
    expect(state.logs).toEqual([]);
  });

  it("has ES and EN copy for every refusal, the notes beside the button, and the log line", () => {
    for (const m of [es, en]) {
      for (const key of ["stampNeedsSale", "stampSaleNotPaid", "stampSaleNotToday", "stampSaleUsed"] as const) expect(m.apiErr[key]).toBeTruthy();
      expect(m.loyalty.needsSale).toBeTruthy();
      expect(m.loyalty.saleNote).toBeTruthy();
      expect(m.loyalty.overrideNote).toBeTruthy();
      expect(m.dash.logOverride).toBeTruthy();
    }
    expect(es.apiErr.stampNeedsSale).not.toBe(en.apiErr.stampNeedsSale);
  });
});

const read = (file: string) => readFileSync(file, "utf8");
const schema = read("supabase/schema.sql");
const fn = (name: string) => schema.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? "";

describe("finding 1: the database checks the sale", () => {
  const v2 = fn("loyalty_stamp_v2");
  it("locks the sale before the card, and checks paid, today and used before inserting", () => {
    const sale = v2.indexOf("from orders o where o.id = p_order and o.restaurant_id = p_restaurant for update");
    const card = v2.indexOf("from loyalty_cards c");
    expect(sale).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(sale);
    const insert = v2.indexOf("insert into loyalty_visits");
    for (const refusal of ["'saleNotPaid'", "'saleNotToday'", "'saleUsed'"]) {
      expect(v2.indexOf(refusal)).toBeGreaterThan(card);
      expect(v2.indexOf(refusal)).toBeLessThan(insert);
    }
    expect(v2).toContain("not v_order.paid or v_order.status = 'cancelled' or v_order.written_off");
    expect(v2).toContain("public.settled_by_write_off(p_restaurant, p_order)");
    expect(v2).toContain("(p.created_at at time zone v_zone)::date = v_day");
    expect(v2).toContain("v_order.loyalty_card_id <> v_card.id");
    expect(v2).toContain("v.order_id = p_order and v.card_id <> v_card.id");
  });

  it("records the sale on the visit, once across every card, and keeps the old signature for the rollout", () => {
    expect(v2).toContain("values (v_card.id, p_restaurant, v_day, p_actor, p_order, clock_timestamp())");
    expect(schema).toContain("alter table loyalty_visits add column if not exists order_id uuid references orders(id) on delete set null;");
    expect(schema).toContain("create unique index if not exists loyalty_visits_order_once on loyalty_visits(order_id) where order_id is not null;");
    expect(fn("loyalty_stamp")).toContain("create or replace function public.loyalty_stamp(p_restaurant uuid, p_code text, p_actor text)");
    expect(schema).toContain("revoke all on function public.loyalty_stamp_v2(uuid, text, text, uuid) from public, anon, authenticated;");
    expect(read("supabase/drop.sql")).toContain("drop function if exists public.loyalty_stamp_v2(uuid, text, text, uuid);");
    expect(read("scripts/rls-check.mjs")).toContain('["loyalty_stamp_v2",');
    expect(read("src/lib/loyalty/server.ts")).toContain('db.rpc("loyalty_stamp_v2"');
  });

  it("the till passes the sale it just charged; a waiter with none is told a manager can stamp", () => {
    expect(read("src/components/dashboard/loyalty/StampCard.tsx")).toContain('kind === "stamp" && saleId ? { code, saleId } : { code }');
    expect(read("src/components/dashboard/loyalty/StampCard.tsx")).toContain('t("loyalty.needsSale")');
    expect(read("src/components/dashboard/pos/PosScreen.tsx")).toContain("saleId={stampSale}");
    expect(read("src/hooks/usePosCharge.ts")).toContain("orderId: !data.onAccount");
  });
});

describe("finding 2: the address is read again under the card's lock before sending", () => {
  const recheck = fn("ticket_email_address_for_send");
  it("shares the card's lock with set_card_email, confirms the claim and the address generation", () => {
    expect(recheck).toContain("for share");
    expect(recheck).toContain("o.claim = p_claim and o.finished_at is null");
    expect(recheck).toContain("o.address_key is distinct from v_key");
    expect(recheck.indexOf("for share")).toBeLessThan(recheck.indexOf("'ready'"));
    expect(schema).toContain("grant execute on function public.ticket_email_address_for_send(uuid, uuid, uuid, uuid[]) to service_role;");
    expect(read("supabase/drop.sql")).toContain("drop function if exists public.ticket_email_address_for_send(uuid, uuid, uuid, uuid[]);");
  });

  it("the sender calls it after rendering and before the provider, and sends to what it answers", () => {
    const sender = read("src/lib/ticket-email.ts");
    const render = sender.indexOf("renderTicketMail(db");
    const ready = sender.indexOf('db.rpc("ticket_email_address_for_send"');
    const send = sender.indexOf("sendMail(ticketMail(body, answer.email, key))");
    expect(render).toBeGreaterThan(0);
    expect(ready).toBeGreaterThan(render);
    expect(send).toBeGreaterThan(ready);
  });
});

describe("finding 3: one settlement, one email", () => {
  it("records the settlement when queueing and claims every waiting row of it together", () => {
    expect(fn("queue_ticket_email")).toContain("c.id::text || ':' || coalesce(new.session_id, new.id)::text || ':' || c.email_unsubscribe::text");
    const claim = fn("claim_ticket_emails");
    expect(claim).toContain("select t.id, t.batch_key, t.group_key from ticket_email_outbox t");
    expect(claim).toContain("t.group_key in (select s.group_key from seed s where s.batch_key is null and s.group_key is not null)");
    expect(claim).toContain("coalesce(o.batch_key, o.group_key, o.id::text)");
    expect(read("src/lib/ticket-email.ts")).toContain("row.batch_key ?? row.group_key ??");
  });
});

describe("finding 4: a redemption is timed after the card lock", () => {
  it("stamps the redemption with clock_timestamp() after locking the card, so the undo guard sees it", () => {
    const redeem = fn("loyalty_redeem");
    const lock = redeem.indexOf("for update");
    const insert = redeem.indexOf("insert into loyalty_redemptions");
    expect(lock).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(lock);
    expect(redeem).toContain("p_actor, v_visits, v_card.round_no, clock_timestamp())");
    expect(fn("loyalty_unstamp")).toContain("r.created_at >= v_visit.created_at");
  });
});
