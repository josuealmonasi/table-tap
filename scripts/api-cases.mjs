import { tableJoinScenario } from "./table-join-scenario.mjs";
import { checkTableJoin } from "./check-table-join.mjs";
// ============================================================================
// One case per endpoint: the request that SHOULD work.
//
// `pnpm rls` tests who gets refused and `invariants` that a guard exists.
// Neither tests that a legitimate request does its job, and that is the gap the
// bugs the user found before we did came through.
//
// `expect` is the state considered healthy. Several endpoints depend on Stripe,
// and with no connected account their correct answer is a specific refusal
// (409, 400) — that is working. What is never right is a 500.
// ============================================================================
import { MARK, PART_AMOUNT, PART_TIP } from "./api-fixtures.mjs";
import { offlineCases } from "./api-offline-cases.mjs";
import { terminalDepositRace } from "./api-terminal-deposit.mjs";
import { twoSittingCollection } from "./api-part-collection.mjs";
import { loginByEmail } from "./logins.mjs";

// The pass holds a ticket id, never the diner's order lookup credential.
async function kitchenTicketId(f, orderId) {
  const { data, error } = await f.admin.from("orders").select("kitchen_ticket_id")
    .eq("id", orderId).eq("restaurant_id", f.restaurant.id).single();
  if (error || !data?.kitchen_ticket_id) throw new Error(`no kitchen ticket: ${error?.message ?? orderId}`);
  return data.kitchen_ticket_id;
}

async function returnFor(f, orderId) {
  const { data, error } = await f.admin.from("refund_operations")
    .select("id, amount, source, status, confirmed_by, payout_actor, order_adjustments!inner(order_id)")
    .eq("restaurant_id", f.restaurant.id).eq("order_adjustments.order_id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Creating a coupon answers `{ ok: true }`, so the id is looked up where it lives. */
async function pendingWriteOff(fx) {
  const { data } = await fx.admin
    .from("write_off_requests").select("id")
    .eq("restaurant_id", fx.restaurant.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? "";
}

async function pendingDiscount(fx) {
  const { data } = await fx.admin
    .from("discount_requests").select("id")
    .eq("restaurant_id", fx.restaurant.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? "";
}

async function promoId(fx) {
  const { data } = await fx.admin
    .from("promotions").select("id")
    .eq("restaurant_id", fx.restaurant.id).like("name", `${MARK}%`)
    .limit(1).maybeSingle();
  return data?.id ?? "";
}

/**
 * Any order of this restaurant's — the print route only needs one to exist.
 *
 * Remembered on the fixture, because a reprint queues a job against an order
 * the seed made: deleting the orders this run created leaves that job sitting
 * in the queue, and teardown has no other way to find it.
 */
async function anyOrderId(fx) {
  const { data } = await fx.admin
    .from("orders").select("id").eq("restaurant_id", fx.restaurant.id).limit(1).maybeSingle();
  if (data?.id) (fx.printedOrders ??= []).push(data.id);
  return data?.id ?? "";
}

async function dietaryTagId(fx) {
  const { data } = await fx.admin
    .from("dietary_tags").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("key", `${MARK}_diet`).maybeSingle();
  return data?.id ?? "";
}

async function iconGroupId(fx) {
  const { data } = await fx.admin
    .from("icon_groups").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("name", `${MARK} icons`).maybeSingle();
  return data?.id ?? "";
}

async function couponId(fx) {
  const { data } = await fx.admin
    .from("coupons").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("code", "API-001").maybeSingle();
  return data?.id ?? "";
}

/** A documentation address (TEST-NET-3), standing in for a restaurant's Wi-Fi. */
const ROOM_ADDRESS = "203.0.113.30";

export function cases(fx) {
  const { restaurant, table, dish, paidOrder, unpaidOrder, tableOrder, walkoutOrder } = fx;
  // One reference per run, shared by the two cases below: the first collection
  // and the retry of that same collection. Fresh each run so a row a previous
  // run somehow left behind cannot make the first call look like the second.
  const partRef = `${MARK}-part-${Date.now()}`;
  const r = restaurant.id;

  return [
    { name: "POST /api/table-membership (approval, rejection, a new party and paying old food)",
      as: "diner", method: "POST", path: "/api/table-membership",
      headers: f => ({ cookie: f.joinScenario.second.cookie }),
      arrange: async f => {
        f.joinScenario = await tableJoinScenario({ admin: f.admin, base: f.base, restaurantId: r, dish: f.dish });
        return f.joinScenario.cleanup;
      },
      body: f => f.joinScenario.body, expect: [200],
      check: async (data, f) => {
        if (data.status !== "pending") return "a new phone was not pending";
        try { return await checkTableJoin(f.joinScenario, f.who); }
        catch (error) { return error.message; }
      } },
    { name: "POST /api/pos/upload (new money is refused)", as: "cashier", method: "POST", path: "/api/pos/upload", body: {}, expect: [400] },
    { name: "POST /api/terminal/deposits/verify (missing bank confirmation)", as: "manager", method: "POST", path: "/api/terminal/deposits/verify", body: {}, expect: [400] },
    { name: "POST /api/pos/recover (missing attestation)", as: "owner", method: "POST", path: "/api/pos/recover", body: {}, expect: [400] },
    { name: "order returns list", path: "/api/order-refunds", method: "GET", as: "owner", expect: [200] },
    { name: "unknown order return cannot be confirmed", path: "/api/order-refunds", method: "POST", as: "owner", body: { id: "00000000-0000-0000-0000-000000000000" }, expect: [404] },
    { name: "historical receipt attribution list", path: "/api/payment-attribution", method: "GET", as: "owner", expect: [200] },
    { name: "empty receipt attribution refused", path: "/api/payment-attribution", method: "POST", as: "owner", body: {}, expect: [400] },

    // ── what the diner touches, with no session ──────────────────────────
    { name: "GET  /api/session", as: "diner", method: "GET",
      path: `/api/session?id=${fx.sessionId ?? ""}`, expect: fx.sessionId ? [200] : [400] },
    { name: "GET  /api/bill (table)", as: "diner", method: "GET",
      path: `/api/bill?restaurantId=${r}&tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/order-status", as: "diner", method: "GET",
      path: `/api/order-status?id=${paidOrder}`, expect: [200] },
    // A room behind one address, which is what a restaurant's Wi-Fi is. The
    // limit was 120 a minute, sized for one phone; thirty diners on the menu
    // used it up, and every tracker in the room froze. 130 asks first, then
    // this one must still be answered. On production the address is the
    // runner's own, because Vercel sets the header itself.
    { name: "GET  /api/order-status (a full room behind one address)", as: "diner", method: "GET",
      path: `/api/order-status?id=${paidOrder}`, headers: { "x-forwarded-for": ROOM_ADDRESS },
      arrange: async f => {
        const ask = () => fetch(`${f.base}/api/order-status?id=${paidOrder}`, {
          headers: { "x-forwarded-for": ROOM_ADDRESS },
        }).then(res => res.status);
        const clear = () => f.admin.from("rate_limits").delete().eq("bucket", `order-status:${ROOM_ADDRESS}`);
        try {
          for (let batch = 0; batch < 13; batch++) await Promise.all(Array.from({ length: 10 }, ask));
        } catch (e) {
          await clear(); // a room half-counted would refuse the next run's first asks
          throw e;
        }
        return clear;
      },
      expect: [200] },
    { name: "POST /api/service-requests", as: "diner", method: "POST", path: "/api/service-requests",
      body: { restaurantId: r, tableId: table.id, kind: "waiter" }, expect: [200] },
    { name: "PATCH /api/service-requests (kitchen answers a call without a table id)", as: "kitchen",
      method: "PATCH", path: "/api/service-requests",
      arrange: async f => {
        const { data, error } = await f.admin.from("service_requests").insert({
          restaurant_id: r, table_id: table.id, table_label: table.label, kind: "bill",
        }).select("id").single();
        if (error) throw new Error(error.message);
        f.kitchenCall = data.id;
        return () => f.admin.from("service_requests").delete().eq("id", data.id);
      },
      body: f => ({ id: f.kitchenCall }), expect: [200],
      check: d => d.ok === true && Object.keys(d).length === 1 || "answering a call returned more than its result",
      effect: async f => {
        const { data, error } = await f.admin.from("kitchen_requests").select("status")
          .eq("id", f.kitchenCall).single();
        return !error && data?.status === "done" || "the kitchen's live call stayed open";
      } },
    { name: "POST /api/ratings/pending", as: "diner", method: "POST", path: "/api/ratings/pending",
      body: { restaurantId: r, orderIds: [paidOrder] }, expect: [200],
      check: d => Array.isArray(d.dishes) && d.dishes.length > 0 || "did not offer the dish that was bought" },
    { name: "POST /api/ratings", as: "diner", method: "POST", path: "/api/ratings",
      body: { restaurantId: r, ratings: [{ orderId: paidOrder, itemId: dish.id, rating: 5 }] },
      expect: [200], check: d => d.saved === 1 || `saved ${d.saved}` },
    { name: "POST /api/coupons/validate", as: "diner", method: "POST", path: "/api/coupons/validate",
      body: { restaurantId: r, code: "API-001", subtotal: 100 }, expect: [200, 400, 404] },
    // A diner checking their visit card by its code. What comes back is what
    // the card itself would show — never who stamped it, never its row id.
    { name: "GET  /api/rewards (a card)", as: "diner", method: "GET",
      path: `/api/rewards?c=${fx.loyaltyCode ?? "no-card-in-the-seed"}`, expect: [200],
      check: d => {
        if (!d.standing || !(d.standing.goal > 0)) return `no standing in ${JSON.stringify(d).slice(0, 80)}`;
        // The restaurant's own id is its public menu address — printed in
        // every table's QR — and is what the page's way back links to.
        if (d.restaurant?.id !== r) return `the way back points at ${d.restaurant?.id}, not the card's restaurant`;
        const said = JSON.stringify({ ...d, restaurant: { ...d.restaurant, id: undefined } });
        if (said.includes("@")) return "the lookup names the staff who stamped the card";
        if (/[0-9a-f]{8}-[0-9a-f]{4}-/.test(said)) return "the lookup hands out a row id";
        // The seed's cards were saved when they were made, and no round has
        // moved their rewards since.
        if (d.saveAgain !== false) return "a card nobody changed is asked to be saved again";
        return true;
      } },
    // Saved before its round closed onto new rewards, the picture shows
    // rewards the card no longer has: the page asks for it to be saved again,
    // and saving it stops the asking.
    { name: "GET  /api/rewards (a card whose rewards moved on)", as: "diner", method: "GET",
      path: `/api/rewards?c=${fx.loyaltyCode ?? "no-card-in-the-seed"}`,
      arrange: f => f.withCardSavedBefore(fx.loyaltyCode),
      expect: [200], check: d => d.saveAgain === true || "the page does not ask for the picture again" },
    { name: "PATCH /api/rewards (the diner saved the picture)", as: "diner", method: "PATCH",
      path: `/api/rewards?c=${fx.loyaltyCode ?? "no-card-in-the-seed"}`,
      arrange: f => f.withCardSavedBefore(fx.loyaltyCode),
      expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("loyalty_cards").select("saved_at, ladder_at")
          .eq("code", fx.loyaltyCode).maybeSingle();
        return new Date(data.saved_at) >= new Date(data.ladder_at) || "saving did not stop the page asking";
      } },
    { name: "PATCH /api/rewards (no such card)", as: "diner", method: "PATCH",
      path: "/api/rewards?c=0000-0000-0000", expect: [404], expectError: /encontramos|couldn't find/i },
    // Rewards the restaurant added since the card's round started are the
    // next round's (terms) — said on the page, not left to be wondered at.
    { name: "GET  /api/rewards (the program's rewards changed)", as: "diner", method: "GET",
      path: `/api/rewards?c=${fx.loyaltyCode ?? "no-card-in-the-seed"}`,
      arrange: f => f.withProgramRewardRenamed(),
      expect: [200],
      check: d => (Array.isArray(d.upcoming) && d.upcoming.length > 0) || `upcoming is ${JSON.stringify(d.upcoming)}` },
    { name: "GET  /api/rewards (no such card)", as: "diner", method: "GET",
      path: "/api/rewards?c=0000-0000-0000", expect: [404], expectError: /encontramos|couldn't find/i },
    { name: "GET  /api/rewards (not a code)", as: "diner", method: "GET",
      path: "/api/rewards?c=abc", expect: [400], expectError: /no parece|doesn't look/i },
    // ── the visit card, stamped and spent by the floor ────────────────────
    // A card on its way with no visit today: the first scan counts, the
    // second the same day says so and adds nothing.
    { name: "POST /api/loyalty/stamp (a card, first visit today)", as: "waiter", method: "POST",
      path: "/api/loyalty/stamp", body: { code: fx.stampableCode ?? "no-card-in-the-seed" }, expect: [200],
      check: d => d.stamped === true || `answered ${JSON.stringify(d)}` },
    { name: "POST /api/loyalty/stamp (the same card again today)", as: "cashier", method: "POST",
      path: "/api/loyalty/stamp", body: { code: fx.stampableCode ?? "no-card-in-the-seed" }, expect: [200],
      check: d => d.stamped === false || "a second scan the same day added a visit" },
    { name: "POST /api/loyalty/stamp (kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/loyalty/stamp", body: { code: fx.stampableCode ?? "" }, expect: [403] },
    { name: "POST /api/loyalty/stamp (no such card here)", as: "waiter", method: "POST",
      path: "/api/loyalty/stamp", body: { code: "0000-0000-0000" },
      expect: [404], expectError: /no es de este restaurante|isn't one of this restaurant's/i },
    { name: "POST /api/loyalty/stamp (program switched off)", as: "waiter", method: "POST",
      path: "/api/loyalty/stamp", arrange: f => f.withLoyaltyOff(), body: { code: fx.stampableCode ?? "" },
      expect: [409], expectError: /apagada|switched off/i },
    { name: "POST /api/loyalty/redeem (not ready yet)", as: "waiter", method: "POST",
      path: "/api/loyalty/redeem", body: { code: fx.stampableCode ?? "" },
      expect: [409], expectError: /faltan visitas|hasn't reached/i },
    // The reward the waiter pressed is named, so the same tap twice spends it
    // once — on a ladder, a second tap would otherwise spend the NEXT reward.
    { name: "POST /api/loyalty/redeem (a ready card)", as: "cashier", method: "POST",
      path: "/api/loyalty/redeem", body: { code: fx.readyCode ?? "no-ready-card-in-the-seed", step: fx.readyStep }, expect: [200],
      check: d => {
        if (typeof d.spent !== "string" || d.standing?.ready !== false) return `answered ${JSON.stringify(d)}`;
        const step = (d.standing.steps ?? []).find(s => s.visits === fx.readyStep);
        return !step || step.done || d.standing.goal === fx.readyStep || "the reward spent is not marked redeemed";
      } },
    { name: "POST /api/loyalty/redeem (the same reward twice)", as: "waiter", method: "POST",
      path: "/api/loyalty/redeem", body: { code: fx.readyCode ?? "", step: fx.readyStep },
      expect: [409], expectError: /ya se canjeó|already redeemed/i },
    { name: "POST /api/loyalty/redeem (a step that is not a number)", as: "waiter", method: "POST",
      path: "/api/loyalty/redeem", body: { code: fx.readyCode ?? "", step: "8" }, expect: [400] },
    // A reward already earned is honoured after the program is paused: the
    // diner's page promises it, and Lealtad's lookup keeps the button for it.
    { name: "POST /api/loyalty/redeem (an earned reward, program paused)", as: "manager", method: "POST",
      path: "/api/loyalty/redeem",
      arrange: async f => {
        const rid = f.restaurant.id;
        await f.admin.from("loyalty_cards").delete().eq("code", "PAVSEDXTEST0");
        const { data: card } = await f.admin.from("loyalty_cards")
          .insert({ restaurant_id: rid, code: "PAVSEDXTEST0", goal: 2 }).select("id").single();
        await f.admin.from("loyalty_visits").insert(["2025-01-01", "2025-01-02"].map(visit_day => ({
          card_id: card.id, restaurant_id: rid, visit_day, actor_email: "api@tabletap.dev",
        })));
        f.pausedCard = card.id;
        const restoreProgram = await f.withLoyaltyOff();
        return async () => {
          await restoreProgram();
          await f.admin.from("loyalty_cards").delete().eq("id", card.id);
        };
      },
      body: { code: "PAVSEDXTEST0" }, expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("loyalty_redemptions").select("id", { count: "exact", head: true }).eq("card_id", f.pausedCard);
        return count === 1 || `the earned reward was spent ${count} times`;
      } },
    // ── the visit card a diner makes, keeps, and may delete ───────────────
    { name: "POST /api/loyalty/card (a diner makes one at their table)", as: "diner", method: "POST",
      path: "/api/loyalty/card",
      body: async (f, saved) => {
        saved.tablePass = await f.visitPass(`/r/${r}/t/${f.table.id}`);
        // Taken now for the case that switches the program off: a page with
        // the program off offers no card, so it hands out no pass.
        saved.unspentPass = await f.visitPass(`/r/${r}/t/${f.table.id}`);
        return { restaurantId: r, pass: saved.tablePass };
      },
      expect: [200],
      check: d => {
        if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(d.code ?? "")) return `no valid code in ${JSON.stringify(d).slice(0, 80)}`;
        if (!d.face?.qrPayload?.endsWith(`/rewards?c=${d.code}`)) return "the QR does not point at the card's own page";
        if (!(d.qr?.size > 0 && d.qr.bits.length === d.qr.size * d.qr.size)) return "the QR grid is not square";
        return JSON.stringify(d).includes("@") ? "the new card names somebody" : true;
      } },
    { name: "POST /api/loyalty/card (the same page asks twice)", as: "diner", method: "POST",
      path: "/api/loyalty/card", body: (_f, saved) => ({ restaurantId: r, pass: saved.tablePass }),
      expect: [409], expectError: /ya hizo su tarjeta|already made its card/i },
    { name: "POST /api/loyalty/card (from the counter menu)", as: "diner", method: "POST",
      path: "/api/loyalty/card", body: async f => ({ restaurantId: r, pass: await f.visitPass(`/r/${r}`) }),
      expect: [200], check: d => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(d.code ?? "") || "no card from the counter menu" },
    { name: "POST /api/loyalty/card (from an order's tracker)", as: "diner", method: "POST",
      path: "/api/loyalty/card", body: async f => ({ restaurantId: r, pass: await f.visitPass(`/order/${f.paidOrder}`) }),
      expect: [200], check: d => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(d.code ?? "") || "no card from the tracker" },
    { name: "POST /api/loyalty/card (from outside: no pass)", as: "diner", method: "POST",
      path: "/api/loyalty/card", body: { restaurantId: r },
      expect: [403], expectError: /desde la carta|from the restaurant's menu/i },
    { name: "POST /api/loyalty/card (a pass carried to another restaurant)", as: "diner", method: "POST",
      path: "/api/loyalty/card",
      body: async f => ({ restaurantId: "00000000-0000-4000-8000-000000000000", pass: await f.visitPass(`/r/${r}`) }),
      expect: [403], expectError: /desde la carta|from the restaurant's menu/i },
    { name: "POST /api/loyalty/card (the program switched off)", as: "diner", method: "POST",
      path: "/api/loyalty/card", arrange: f => f.withLoyaltyOff(),
      body: (_f, saved) => ({ restaurantId: r, pass: saved.unspentPass }),
      expect: [409], expectError: /apagada|switched off/i },
    { name: "POST /api/loyalty/card (not a restaurant)", as: "diner", method: "POST",
      path: "/api/loyalty/card", body: { restaurantId: "not-an-id" }, expect: [400] },
    { name: "DELETE /api/rewards (a diner deletes their card)", as: "diner", method: "DELETE",
      path: `/api/rewards?c=${fx.throwawayCode}`, expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("loyalty_cards").select("id", { count: "exact", head: true }).eq("code", f.throwawayCode);
        return count === 0 || "the card is still there";
      } },
    { name: "DELETE /api/rewards (no such card)", as: "diner", method: "DELETE",
      path: "/api/rewards?c=0000-0000-0000", expect: [404], expectError: /encontramos|couldn't find/i },
    // ── the visit card, run by the owner and the managers ─────────────────
    { name: "GET  /api/loyalty/lookup (a card, with who stamped it)", as: "manager", method: "GET",
      path: `/api/loyalty/lookup?c=${fx.stampableCode ?? "no-card-in-the-seed"}`, expect: [200],
      check: d => (d.visits?.length > 0 && d.visits.every(v => typeof v.by === "string" && v.by.includes("@")))
        || `the lookup did not name who stamped: ${JSON.stringify(d).slice(0, 120)}` },
    { name: "GET  /api/loyalty/lookup (waiter refused)", as: "waiter", method: "GET",
      path: `/api/loyalty/lookup?c=${fx.stampableCode ?? ""}`, expect: [403] },
    // Today's stamp — the one the first stamp case above made — can be taken
    // back; one from before today cannot.
    { name: "DELETE /api/loyalty/visit (a visit from before today)", as: "manager", method: "DELETE",
      path: "/api/loyalty/visit", body: async f => ({ id: await f.visitOf(f.stampableCode, "past") }),
      expect: [409], expectError: /solo se pueden quitar|only today's/i },
    { name: "DELETE /api/loyalty/visit (waiter refused)", as: "waiter", method: "DELETE",
      path: "/api/loyalty/visit", body: async f => ({ id: await f.visitOf(f.stampableCode, "today") }), expect: [403] },
    { name: "DELETE /api/loyalty/visit (today's stamp, taken back)", as: "manager", method: "DELETE",
      path: "/api/loyalty/visit", body: async f => ({ id: await f.visitOf(f.stampableCode, "today") }), expect: [200],
      check: async (_d, f) => (await f.visitOf(f.stampableCode, "today")) === null || "the visit is still there" },
    // Today's stamp with a reward spent after it is part of that reward's
    // record: taking it back left the card owing a visit, a count below zero.
    { name: "DELETE /api/loyalty/visit (today's stamp, a reward spent after it)", as: "manager", method: "DELETE",
      path: "/api/loyalty/visit",
      arrange: async f => {
        const rid = f.restaurant.id;
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: f.restaurant.timezone ?? "America/Mexico_City" }).format(new Date());
        await f.admin.from("loyalty_cards").delete().eq("code", "SPNTXTEST000");
        const { data: card } = await f.admin.from("loyalty_cards")
          .insert({ restaurant_id: rid, code: "SPNTXTEST000", goal: 2 }).select("id").single();
        await f.admin.from("loyalty_visits").insert({ card_id: card.id, restaurant_id: rid, visit_day: "2025-01-01", actor_email: "api@tabletap.dev" });
        const { data: visit } = await f.admin.from("loyalty_visits").insert({
          card_id: card.id, restaurant_id: rid, visit_day: today, actor_email: "api@tabletap.dev",
          created_at: new Date(Date.now() - 60_000).toISOString(),
        }).select("id").single();
        await f.admin.from("loyalty_redemptions").insert({
          card_id: card.id, restaurant_id: rid, visits_used: 2, reward: "api", actor_email: "api@tabletap.dev",
        });
        f.spentVisit = visit.id;
        return () => f.admin.from("loyalty_cards").delete().eq("id", card.id);
      },
      body: f => ({ id: f.spentVisit }),
      expect: [409], expectError: /no se puede quitar|can't be taken back/i,
      check: async (_d, f) => {
        const { count } = await f.admin.from("loyalty_visits").select("id", { count: "exact", head: true }).eq("id", f.spentVisit);
        return count === 1 || "the stamp was taken back anyway";
      } },
    { name: "POST /api/loyalty/program (a reward ladder)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: true, steps: [{ visits: 10, reward: "Free main" }, { visits: 3, reward: "Free coffee" }] }, expect: [200],
      check: async (_d, f) => {
        // Compared as values: jsonb keeps an object's keys in its own order.
        const steps = (await f.programSteps() ?? []).map(s => `${s.visits}=${s.reward}`).join(", ");
        if (steps !== "3=Free coffee, 10=Free main") return `the ladder was saved as ${steps}`;
        return (await f.programGoal()) === 10 || "the goal is not the last reward's visits";
      } },
    // A page open across the deploy still sends one goal and one reward.
    { name: "POST /api/loyalty/program (a goal, from a page before the ladder)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: true, goal: 9, reward: "Free dessert" }, expect: [200],
      check: async (_d, f) => (await f.programGoal()) === 9 || "the goal was not saved" },
    { name: "POST /api/loyalty/program (two rewards at the same visits)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: true, steps: [{ visits: 8, reward: "a" }, { visits: 8, reward: "b" }] },
      expect: [400], expectError: /mismo número de visitas|same number of visits/i },
    { name: "POST /api/loyalty/program (five rewards)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: true, steps: [3, 6, 9, 12, 15].map(visits => ({ visits, reward: "x" })) },
      expect: [400], expectError: /hasta 4 recompensas|up to 4 rewards/i },
    { name: "POST /api/loyalty/program (a reward left blank)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: false, steps: [{ visits: 4, reward: "Free coffee" }, { visits: 8, reward: " " }] },
      expect: [400], expectError: /cada recompensa|each reward/i },
    { name: "POST /api/loyalty/program (switched on with no reward)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: true, goal: 8, reward: "  " }, expect: [400], expectError: /recompensa|reward/i },
    { name: "POST /api/loyalty/program (a goal out of range)", as: "manager", method: "POST",
      path: "/api/loyalty/program", arrange: f => f.keepLoyaltyProgram(),
      body: { active: true, goal: 500, reward: "Free dessert" }, expect: [400], expectError: /entre 2 y 50|between 2 and 50/i },
    { name: "POST /api/loyalty/program (waiter refused)", as: "waiter", method: "POST",
      path: "/api/loyalty/program", body: { active: false, goal: 8, reward: "" }, expect: [403] },
    { name: "GET  /api/order-qr", as: "diner", method: "GET",
      path: `/api/order-qr?id=${paidOrder}`, expect: [200],
      // A 200 with an empty body would be exactly the failure this file exists
      // to catch: staff would point a camera at nothing.
      checkText: t => t.startsWith("<svg") || `answered ${t.slice(0, 40)}` },
    // ── dividing a bill ───────────────────────────────────────────────────
    // The read is real. The writes are checked by the refusals they must give:
    // proposing one for real would leave a live split on the demo table, and
    // `pnpm api:prod` would leave it on a real one.
    { name: "GET  /api/split (nothing going on)", as: "diner", method: "GET",
      path: `/api/split?sessionId=${fx.sessionId ?? ""}&diner=apicheck&restaurantId=${r}&tableId=${table.id}`,
      expect: [200, 400] },
    { name: "POST /api/split (refuses one person)", as: "diner", method: "POST", path: "/api/split",
      body: { sessionId: fx.sessionId ?? "", diner: "apicheck", restaurantId: r, tableId: table.id, shares: 1 },
      expect: [400] },
    // Proposed for real, on a table of its own with two diners' unpaid orders,
    // and judged by the seat: the call that seats the proposer once named the
    // old function's arguments, failed unread, and left them without a share.
    { name: "POST /api/split (the proposer takes a seat)", as: "diner", method: "POST", path: "/api/split",
      arrange: async f => {
        const { data: t } = await f.admin.from("restaurant_tables")
          .insert({ restaurant_id: r, label: `${MARK}-propose` }).select("id, label").single();
        const { data: sit } = await f.admin.from("table_sessions")
          .insert({ restaurant_id: r, table_id: t.id }).select("id").single();
        const order = diner => ({
          restaurant_id: r, table_id: t.id, table_label: t.label, session_id: sit.id, diner,
          items: [{ itemId: f.dish.id, name: f.dish.name, emoji: "🍽️", price: f.lineTotal, qty: 1, mods: {} }],
          subtotal: f.lineTotal, service_fee: 0, tip: 0, tax_pct: 0, discount: 0, total: f.lineTotal,
          note: MARK, status: "received", paid: false,
        });
        const { error } = await f.admin.from("orders").insert([order(`${MARK}-a`), order(`${MARK}-b`)]);
        if (error) throw new Error(`could not seat two diners: ${error.message}`);
        f.propose = { table: t.id, session: sit.id };
        return async () => {
          const { data: splits } = await f.admin.from("bill_splits").select("id").eq("session_id", sit.id);
          const ids = (splits ?? []).map(x => x.id);
          if (ids.length) {
            await f.admin.from("bill_split_claims").delete().in("split_id", ids);
            await f.admin.from("bill_splits").delete().in("id", ids);
          }
          await f.admin.from("orders").delete().eq("session_id", sit.id);
          await f.admin.from("table_sessions").delete().eq("id", sit.id);
          await f.admin.from("restaurant_tables").delete().eq("id", t.id);
        };
      },
      body: f => ({ sessionId: f.propose.session, diner: `${MARK}-a`, restaurantId: r, tableId: f.propose.table, shares: 2 }),
      expect: [200],
      check: async (_d, f) => {
        const { data: split } = await f.admin.from("bill_splits").select("id")
          .eq("session_id", f.propose.session).eq("status", "proposed").maybeSingle();
        if (!split) return "no proposal was recorded";
        const { data: seats } = await f.admin.from("bill_split_claims").select("diner").eq("split_id", split.id);
        return (seats ?? []).some(x => x.diner === f.phoneMembers.idFor(f.propose.session, `${MARK}-a`)) || `the proposer has no seat (${JSON.stringify(seats)})`;
      } },
    // Valid JSON with the wrong types: each of these once answered 500.
    { name: "POST /api/receipt (order ids that are not a list)", as: "diner", method: "POST", path: "/api/receipt",
      body: { orderIds: "x", email: "a@example.com" }, expect: [400, 429] },
    { name: "POST /api/ratings (a rating that is null)", as: "diner", method: "POST", path: "/api/ratings",
      body: { restaurantId: r, ratings: [null] }, expect: [400, 429] },
    { name: "POST /api/signup (a name that is a number)", as: "diner", method: "POST", path: "/api/signup",
      body: { acceptedTerms: true, restaurantName: 7, email: "a@example.com", password: "abcdefgh" }, expect: [400, 429] },
    { name: "POST /api/split/join (no such split)", as: "diner", method: "POST", path: "/api/split/join",
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409] },
    // These three need a card reader, and saying so is the point.
    //
    // /api/split/pay turns everybody away when the restaurant has none — 65%
    // of the route sits behind that one line — and it says so with a 409. The
    // case that used to live here expected 409 for "no such split" and was
    // being handed "this restaurant cannot take cards" instead: a green tick
    // for a refusal it never reached. `arrange` lends the reader for the
    // request and takes it back afterwards, so the refusals below are the
    // route's own.
    { name: "POST /api/split/pay (no card reader)", as: "diner", method: "POST",
      path: "/api/split/pay",
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409], expectError: /tarjeta|card payments/i },
    { name: "POST /api/split/pay (no such split)", as: "diner", method: "POST",
      path: "/api/split/pay", arrange: f => f.withCardReader(),
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409], expectError: /falta gente|agreed to the split/i },
    { name: "POST /api/split/pay (a share that is not yours)", as: "diner", method: "POST",
      path: "/api/split/pay", arrange: f => f.withCardReader(),
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: "nobody-here", restaurantId: r, tableId: f.splitTableId }),
      // 403: the split is real and locked, and this device has no claim on it.
      expect: [403], expectError: /no tienes una parte|do not have a share/i },
    // A real share of this restaurant's split, paid through ANOTHER
    // restaurant that takes cards: nothing tied the split to the restaurant
    // whose Stripe account took the money, so the share would have been
    // marked paid here with the money there. Refused before any fee is
    // reserved or Stripe is asked.
    { name: "POST /api/split/pay (a share paid through another restaurant)", as: "diner", method: "POST",
      path: "/api/split/pay",
      arrange: async f => {
        const { data: other } = await f.admin.from("restaurants").select("id, stripe_account_id, stripe_charges_enabled")
          .neq("id", r).order("name").limit(1).single();
        const { data: otherTable } = await f.admin.from("restaurant_tables").select("id")
          .eq("restaurant_id", other.id).order("label").limit(1).single();
        f.otherRestaurant = other.id;
        f.otherTable = otherTable.id;
        await f.admin.from("restaurants").update({ stripe_account_id: "acct_api_check", stripe_charges_enabled: true }).eq("id", other.id);
        return async () => {
          await f.admin.from("restaurants").update({
            stripe_account_id: other.stripe_account_id, stripe_charges_enabled: other.stripe_charges_enabled,
          }).eq("id", other.id);
        };
      },
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: `${MARK}-unpaid`, restaurantId: f.otherRestaurant, tableId: f.otherTable }),
      expect: [403], expectError: /teléfono|phone/i,
      effect: async f => {
        const since = new Date(Date.now() - 120_000).toISOString();
        const { count } = await f.admin.from("platform_fees").select("id", { count: "exact", head: true })
          .eq("restaurant_id", f.otherRestaurant).gte("created_at", since);
        return count === 0 || `${count} fee(s) reserved against the other restaurant`;
      } },
    // A share whose checkout another tab is opening right now: its slice of
    // the fee is reserved and its session not yet noted. A second checkout
    // used to open beside it fee-free, and a diner who paid both paid twice.
    // A share whose checkout is already open is resumed, never opened twice:
    // two payable pages for one share is a diner charged twice. The open
    // attempt is planted as the route records one (before Stripe answers), and
    // the case is judged by effect: still exactly one open attempt for the
    // share. Resuming asks Stripe for that session, which the borrowed reader's
    // account cannot answer here, so the route's own answer is a 502.
    { name: "POST /api/split/pay (a share whose checkout is already open)", as: "diner", method: "POST",
      path: "/api/split/pay",
      arrange: async f => {
        const lend = await f.withCardReader();
        const { data: food } = await f.admin.from("orders").insert({
          restaurant_id: r, table_id: f.splitTableId, session_id: f.splitSessionId, items: [], subtotal: 50,
          service_fee: 0, tip: 0, tax_pct: 0, discount: 0, total: 50, note: MARK, status: "received",
        }).select("id").single();
        f.openShareScope = `split:${f.lockedSplitId}:1`;
        const { data: attempt, error } = await f.admin.from("diner_checkouts").insert({
          restaurant_id: r, stripe_account_id: "acct_api_check", livemode: false, currency: "MXN",
          amount_cents: 5000, metadata: { restaurant_id: r }, order_ids: [food.id], status: "open",
          scope_key: f.openShareScope, idempotency_key: `${MARK}-${f.openShareScope}`,
          stripe_params: { mode: "payment" },
        }).select("id").single();
        if (error) throw new Error(`could not plant the open attempt: ${error.message}`);
        return async () => {
          await f.admin.from("diner_checkouts").delete().eq("restaurant_id", r).eq("scope_key", f.openShareScope);
          if (attempt?.id) await f.admin.from("diner_checkouts").delete().eq("id", attempt.id);
          if (food?.id) await f.admin.from("orders").delete().eq("id", food.id);
          await lend();
        };
      },
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: `${MARK}-unpaid`, restaurantId: r, tableId: f.splitTableId }),
      expect: [200, 502],
      effect: async f => {
        const { count } = await f.admin.from("diner_checkouts").select("id", { count: "exact", head: true })
          .eq("restaurant_id", r).eq("scope_key", f.openShareScope).eq("status", "open");
        return count === 1 || `${count} open checkouts for one share`;
      } },
    { name: "POST /api/split/pay (a share already paid)", as: "diner", method: "POST",
      path: "/api/split/pay", arrange: f => f.withCardReader(),
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: `${MARK}-paid`, restaurantId: r, tableId: f.splitTableId }),
      expect: [409], expectError: /ya está pagada|already paid/i },
    { name: "POST /api/checkout (card)", as: "diner", method: "POST", path: "/api/checkout",
      // With no Stripe account connected the healthy answer is 409, not a 500.
      //
      // Three of them, not one: Stripe will not take a card payment under
      // MX$10, and the cheapest dish on the demo menu is MX$6.50. At qty 1
      // this case was testing Stripe's floor rather than our checkout, and
      // whether it passed depended on which dish the fixture happened to pick.
      body: { restaurantId: r, tableId: null, note: MARK, items: [{ itemId: dish.id,
        name: dish.name, price: Number(dish.price), qty: 3, emoji: "🍽️", mods: {} }] },
      expect: [200, 409] },
    // And the card path itself, which the case above has never reached: with
    // no connected account it is turned away at the door, so the line items,
    // the name trimming and the cart cap that #333 added have never been built
    // for a real session. A fake account gets all the way to Stripe and fails
    // there, and failing THERE is the assertion.
    { name: "POST /api/checkout (card, reaches Stripe)", as: "diner", method: "POST",
      path: "/api/checkout", arrange: f => f.withCardReader(),
      body: { restaurantId: r, tableId: null, note: MARK, items: [{ itemId: dish.id,
        name: dish.name, price: Number(dish.price), qty: 3, emoji: "🍽️", mods: {} }] },
      expect: [500], expectError: /pago falló|payment failed/i,
      // Its fee was reserved under the month's ceiling before Stripe was
      // asked; Stripe refused the session, so it has to be given back — an
      // open reservation would count a fee nobody will ever pay. The released
      // row is removed after, like everything else a case leaves.
      effect: async f => {
        const since = new Date(Date.now() - 120_000).toISOString();
        const { data } = await f.admin.from("platform_fees").select("id, status")
          .eq("restaurant_id", r).eq("source", "order").gte("created_at", since);
        const rows = data ?? [];
        await f.admin.from("platform_fees").delete().in("id", rows.filter(x => x.status === "released").map(x => x.id));
        return (rows.some(x => x.status === "released") && !rows.some(x => x.status === "open"))
          || `the fee it reserved was left ${JSON.stringify(rows.map(x => x.status))}`;
      } },
    // A charge that fails must give the coupon use back. It is reserved before
    // Stripe is called — so a coupon on its last use cannot be spent twice by
    // two diners at once — and a reservation nobody releases burns that use
    // for a sale which never happened, quietly, on the one coupon a restaurant
    // printed a hundred of.
    { name: "POST /api/checkout (a failed charge gives back what it reserved)", as: "diner",
      method: "POST", path: "/api/checkout",
      // Both switches, and both undone afterwards. `undoClaim` releases the
      // coupon AND the stock, and until now only the coupon half was watched —
      // a charge that never happened quietly emptying the shelf would have
      // gone unnoticed.
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const putStockBack = await f.withStock(20);
        return async () => { await putStockBack(); await putReaderBack(); };
      },
      body: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        f.couponUsesBefore = data?.uses_count ?? 0;
        return {
          restaurantId: r, tableId: null, note: MARK, couponCode: f.cardCouponCode,
          items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price),
                    qty: 5, emoji: "🍽️", mods: {} }],
        };
      },
      expect: [500], expectError: /pago falló|payment failed/i,
      effect: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        if (data?.uses_count !== f.couponUsesBefore) {
          return `the coupon went from ${f.couponUsesBefore} uses to ${data?.uses_count} on a sale that never happened`;
        }
        const { data: item } = await f.admin
          .from("menu_items").select("stock").eq("id", f.dish.id).maybeSingle();
        return item?.stock === 20
          ? true
          : `the shelf went from 20 to ${item?.stock} on a sale that never happened`;
      } },
    // ── The cash drawer, a shift at a time ───────────────────────────────
    // A whole shift, in order: nothing can be taken out of a drawer nobody
    // opened; it opens with its cash; one open at a time; cash taken out of
    // it; closed by a blind, signed count; its difference explained once. The
    // people who run the drawer do it, only a manager strikes a withdrawal
    // off, and nobody else may touch any of it.
    { name: "POST /api/cash-drawer (no shift open: nothing to take out of)", as: "cashier", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 50 }, expect: [409],
      expectError: /turno abierto|shift is open/i },
    { name: "POST /api/cash-shift (the cashier opens a shift)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: { action: "open", amount: "1,250.50" }, expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("cash_shifts").select("opening_amount, opened_by, closed_at").eq("id", d.id).maybeSingle();
        return Number(data?.opening_amount) === 1250.5 && data?.opened_by === "demo-cashier@tabletap.dev" && data?.closed_at === null
          || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/cash-shift (a second one while it is open)", as: "manager", method: "POST",
      path: "/api/cash-shift", body: { action: "open", amount: 100 }, expect: [409],
      expectError: /ya hay un turno|already open/i },
    { name: "POST /api/cash-drawer (a withdrawal, in the open shift)", as: "manager", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 120, note: `${MARK} supplier` }, expect: [200],
      save: d => ({ cashWithdrawal: d.id }),
      check: async (d, f) => {
        const [{ data: row }, { data: open }] = await Promise.all([
          f.admin.from("cash_movements").select("kind, amount, note, shift_id").eq("id", d.id).maybeSingle(),
          f.admin.from("cash_shifts").select("id").eq("restaurant_id", r).is("closed_at", null).maybeSingle(),
        ]);
        return row?.kind === "withdrawal" && Number(row.amount) === 120 && row.note === `${MARK} supplier` && row.shift_id === open?.id
          || `stored ${JSON.stringify(row)} in shift ${open?.id}`;
      } },
    { name: "POST /api/cash-drawer (a withdrawal of nothing)", as: "cashier", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: "0" }, expect: [400],
      expectError: /cantidad de efectivo|amount of cash/i },
    { name: "POST /api/cash-drawer (a waiter refused)", as: "waiter", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 50 }, expect: [403] },
    { name: "POST /api/cash-shift (the kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/cash-shift", body: { action: "open", amount: 50 }, expect: [403] },
    { name: "DELETE /api/cash-drawer (a cashier cannot strike off a withdrawal)", as: "cashier", method: "DELETE",
      path: "/api/cash-drawer", body: (_f, saved) => ({ id: saved.cashWithdrawal }), expect: [403] },
    { name: "DELETE /api/cash-drawer (a manager strikes it off)", as: "manager", method: "DELETE",
      path: "/api/cash-drawer", body: (_f, saved) => ({ id: saved.cashWithdrawal }), expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("cash_movements").select("id", { count: "exact", head: true })
          .eq("note", `${MARK} supplier`);
        return count === 0 || "the withdrawal is still there";
      } },
    { name: "DELETE /api/cash-drawer (one that is not here)", as: "manager", method: "DELETE",
      path: "/api/cash-drawer", body: { id: "00000000-0000-4000-8000-000000000000" }, expect: [404],
      expectError: /ya no está|not here/i },
    { name: "POST /api/cash-shift (a close nobody signed off)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: { action: "close", counted: 1000 }, expect: [400],
      expectError: /contaste|counted/i },
    { name: "POST /api/cash-shift (closed on a blind count)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: { action: "close", counted: "1000", confirm: true }, expect: [200],
      save: d => ({ cashShift: d.id }),
      check: async (d, f) => {
        // What the drawer should have held: the opening, the cash taken while
        // it was open (none, in this run), the withdrawal struck off.
        const { data } = await f.admin.from("cash_shifts")
          .select("closed_by, counted_cash, expected_cash, difference").eq("id", d.id).maybeSingle();
        if (Number(d.expected) !== 1250.5) return `expected ${d.expected}, not 1250.50`;
        if (Number(d.difference) !== -250.5) return `a difference of ${d.difference}, not -250.50`;
        return data?.closed_by === "demo-cashier@tabletap.dev" && Number(data.counted_cash) === 1000
          && Number(data.expected_cash) === 1250.5 && Number(data.difference) === -250.5
          || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/cash-drawer (nothing taken out of a closed shift)", as: "manager", method: "POST",
      path: "/api/cash-drawer", body: { kind: "withdrawal", amount: 10 }, expect: [409],
      expectError: /turno abierto|shift is open/i },
    { name: "POST /api/cash-shift (the closer explains the difference)", as: "cashier", method: "POST",
      path: "/api/cash-shift", body: (_f, saved) => ({ action: "explain", id: saved.cashShift, note: `${MARK} change` }),
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("cash_shifts").select("difference_note, explained_by")
          .eq("restaurant_id", r).eq("difference_note", `${MARK} change`).maybeSingle();
        return data?.explained_by === "demo-cashier@tabletap.dev" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/cash-shift (an explanation is given once)", as: "manager", method: "POST",
      path: "/api/cash-shift", body: (_f, saved) => ({ action: "explain", id: saved.cashShift, note: "rewritten" }),
      expect: [409], expectError: /ya tiene explicación|already explained/i },
    { name: "POST /api/cash-shift (a waiter cannot explain one)", as: "waiter", method: "POST",
      path: "/api/cash-shift", body: (_f, saved) => ({ action: "explain", id: saved.cashShift, note: "x" }), expect: [403] },
    // ── Costs: ingredients, a recipe, the terminal's rate ─────────────────
    // Everything named after the run, so teardown finds it; the rate is put
    // back to what the demo had.
    { name: "POST /api/costs/ingredients (the owner adds one, by the litre)", as: "owner", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} milk`, unit: "ml", packSize: "1", packUnit: "l", packPrice: "30", supplier: "Dairy" },
      expect: [200], save: d => ({ ingredient: d.id }),
      check: async (d, f) => {
        f.costIngredient = d.id;
        const { data } = await f.admin.from("ingredients")
          .select("restaurant_id, unit, pack_size, pack_price, unit_cost, supplier").eq("id", d.id).maybeSingle();
        return data?.restaurant_id === r && data.unit === "ml" && Number(data.pack_size) === 1000
          && Number(data.unit_cost) === 0.03 && data.supplier === "Dairy" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/costs/ingredients (the same name twice)", as: "manager", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} MILK`, unit: "ml", packSize: "1", packUnit: "l", packPrice: "30" },
      expect: [409], expectError: /ya hay un ingrediente|already an ingredient/i },
    { name: "POST /api/costs/ingredients (a kilo of something measured in ml)", as: "owner", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} other`, unit: "ml", packSize: "1", packUnit: "kg", packPrice: "30" },
      expect: [400], expectError: /cuánto trae un paquete|how much a pack holds/i },
    { name: "POST /api/costs/ingredients (a cashier refused)", as: "cashier", method: "POST",
      path: "/api/costs/ingredients", body: { name: `${MARK} x`, unit: "g", packSize: "1", packUnit: "kg", packPrice: "1" },
      expect: [403] },
    { name: "PATCH /api/costs/ingredients (the manager records a rise)", as: "manager", method: "PATCH",
      path: "/api/costs/ingredients",
      body: (_f, saved) => ({ id: saved.ingredient, name: `${MARK} milk`, packSize: "1", packUnit: "l", packPrice: "36" }),
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("ingredient_prices")
          .select("previous_cost, unit_cost, changed_by").eq("ingredient_id", f.costIngredient).not("previous_cost", "is", null);
        const rise = data?.[0];
        return data?.length === 1 && Number(rise.previous_cost) === 0.03 && Number(rise.unit_cost) === 0.036
          && rise.changed_by === "demo-manager@tabletap.dev" || `history ${JSON.stringify(data)}`;
      } },
    { name: "PUT  /api/costs/recipe (a line on a choice the product offers)", as: "owner", method: "PUT",
      path: "/api/costs/recipe",
      arrange: async f => {
        const { data } = await f.admin.from("menu_items").insert({
          restaurant_id: r, name: `${MARK} costs latte`, price: 50, available: false,
          modifiers: [{ label: "Milk", type: "single", options: ["Whole", "Oat"] }],
        }).select("id").single();
        f.costItem = data?.id ?? "";
      },
      body: (f, saved) => ({ itemId: f.costItem, lines: [{ ingredientId: saved.ingredient, quantity: "200", modLabel: "Milk", modOption: "Whole" }] }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("recipe_lines")
          .select("restaurant_id, quantity, mod_label, mod_option").eq("item_id", f.costItem);
        return d.lines === 1 && data?.length === 1 && data[0].restaurant_id === r && Number(data[0].quantity) === 200
          && data[0].mod_option === "Whole" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "PUT  /api/costs/recipe (a choice the product does not offer)", as: "owner", method: "PUT",
      path: "/api/costs/recipe",
      body: (f, saved) => ({ itemId: f.costItem, lines: [{ ingredientId: saved.ingredient, quantity: "200", modLabel: "Milk", modOption: "Soy" }] }),
      expect: [400], expectError: /no es una que ofrezca|not one this product offers/i },
    // Another restaurant's ingredient in this one's recipe: refused whole, and
    // the recipe that was there is still there.
    { name: "PUT  /api/costs/recipe (another restaurant's ingredient)", as: "manager", method: "PUT",
      path: "/api/costs/recipe",
      arrange: async f => {
        const { data: other } = await f.admin.from("restaurants").select("id").neq("id", r).limit(1).maybeSingle();
        const { data } = await f.admin.from("ingredients").insert({
          restaurant_id: other.id, name: `${MARK} neighbour`, unit: "g", pack_size: 1000, pack_price: 1, updated_by: MARK,
        }).select("id").single();
        f.foreignIngredient = data?.id ?? "";
        return () => f.admin.from("ingredients").delete().eq("id", f.foreignIngredient);
      },
      body: f => ({ itemId: f.costItem, lines: [{ ingredientId: f.foreignIngredient, quantity: "5" }] }),
      // Refused whole: the archive case below finds the one line still there.
      expect: [409], expectError: /se quitó|was removed/i },
    { name: "PUT  /api/costs/recipe (another restaurant's product)", as: "owner", method: "PUT",
      path: "/api/costs/recipe",
      arrange: async f => {
        const { data } = await f.admin.from("menu_items").select("id").neq("restaurant_id", r).limit(1).maybeSingle();
        f.foreignItem = data?.id ?? "";
      },
      body: (f, saved) => ({ itemId: f.foreignItem, lines: [{ ingredientId: saved.ingredient, quantity: "5" }] }),
      expect: [404], expectError: /no encontrado|not found/i },
    { name: "PUT  /api/costs/recipe (the kitchen refused)", as: "kitchen", method: "PUT",
      path: "/api/costs/recipe", body: f => ({ itemId: f.costItem, lines: [] }), expect: [403] },
    { name: "PATCH /api/costs/settings (the terminal's rate)", as: "manager", method: "PATCH",
      path: "/api/costs/settings", body: { terminalFeePct: "4.25" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("terminal_fee_pct").eq("id", r).single();
        return Number(data.terminal_fee_pct) === 4.25 || `stored ${data.terminal_fee_pct}`;
      } },
    { name: "PATCH /api/costs/settings (a rate no terminal charges)", as: "owner", method: "PATCH",
      path: "/api/costs/settings", body: { terminalFeePct: "20" }, expect: [400],
      expectError: /de 0 a 15|from 0 to 15/i },
    { name: "DELETE /api/costs/ingredients (archived, and out of every recipe)", as: "owner", method: "DELETE",
      path: "/api/costs/ingredients", body: (_f, saved) => ({ id: saved.ingredient }), expect: [200],
      check: async (d, f) => {
        const [{ data: row }, { count }] = await Promise.all([
          f.admin.from("ingredients").select("archived_at").eq("id", f.costIngredient).single(),
          f.admin.from("recipe_lines").select("id", { count: "exact", head: true }).eq("ingredient_id", f.costIngredient),
        ]);
        return row.archived_at !== null && count === 0 && d.recipeLinesRemoved === 1
          || `archived ${row.archived_at}, ${count} line(s) left, ${d.recipeLinesRemoved} reported`;
      } },
    { name: "DELETE /api/costs/ingredients (one already archived)", as: "manager", method: "DELETE",
      path: "/api/costs/ingredients", body: (_f, saved) => ({ id: saved.ingredient }), expect: [404] },
    // ── Stock: a count, a delivery, waste, and the count that compares ────
    { name: "POST /api/costs/ingredients (flour, delivered in three days)", as: "owner", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} flour`, unit: "g", packSize: "1", packUnit: "kg", packPrice: "20", leadDays: "3" },
      expect: [200], save: d => ({ flour: d.id }),
      check: async (d, f) => {
        f.flour = d.id;
        const { data } = await f.admin.from("ingredients").select("lead_days").eq("id", d.id).single();
        return data.lead_days === 3 || `lead_days ${data.lead_days}`;
      } },
    { name: "POST /api/costs/counts (the first count has nothing to compare with)", as: "manager", method: "POST",
      path: "/api/costs/counts", body: (_f, saved) => ({ counts: [{ ingredientId: saved.flour, counted: "5000" }] }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("ingredient_counts").select("counted, expected, counted_by").eq("ingredient_id", f.flour);
        return d.results?.[0]?.expected === null && data?.length === 1 && Number(data[0].counted) === 5000
          && data[0].expected === null && data[0].counted_by === "demo-manager@tabletap.dev" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/costs/purchases (two packs at a new price)", as: "owner", method: "POST",
      path: "/api/costs/purchases", body: (_f, saved) => ({ ingredientId: saved.flour, packs: "2", total: "50" }),
      expect: [200],
      check: async (_d, f) => {
        const [{ data: bought }, { data: flour }, { data: rise }] = await Promise.all([
          f.admin.from("ingredient_purchases").select("quantity, total").eq("ingredient_id", f.flour),
          f.admin.from("ingredients").select("pack_price, unit_cost").eq("id", f.flour).single(),
          f.admin.from("ingredient_prices").select("previous_cost, unit_cost").eq("ingredient_id", f.flour).not("previous_cost", "is", null),
        ]);
        return bought?.length === 1 && Number(bought[0].quantity) === 2000 && Number(bought[0].total) === 50
          && Number(flour.pack_price) === 25 && rise?.length === 1 && Number(rise[0].previous_cost) === 0.02
          && Number(rise[0].unit_cost) === 0.025 || `bought ${JSON.stringify(bought)}, now ${JSON.stringify(flour)}, rise ${JSON.stringify(rise)}`;
      } },
    { name: "POST /api/costs/waste (the kitchen spills half a kilo)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: (_f, saved) => ({ ingredientId: saved.flour, quantity: "500", reason: "spoiled" }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("waste_entries").select("quantity, reason, cost, recorded_by").eq("id", d.id).single();
        if (Object.hasOwn(d, "cost")) return "the kitchen received a private waste cost";
        return Number(data.quantity) === 500 && data.reason === "spoiled" && Number(data.cost) === 12.5
          && data.recorded_by === "demo-kitchen@tabletap.dev" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/costs/counts (compared with the count, the delivery and the waste)", as: "owner", method: "POST",
      path: "/api/costs/counts", body: (_f, saved) => ({ counts: [{ ingredientId: saved.flour, counted: "6400" }] }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("ingredient_counts").select("counted, expected")
          .eq("ingredient_id", f.flour).order("created_at", { ascending: false }).limit(1).single();
        // 5000 counted, 2000 delivered, 500 thrown away: 6500 expected.
        return d.results?.[0]?.expected === 6500 && Number(data.expected) === 6500 && Number(data.counted) === 6400
          || `answered ${JSON.stringify(d.results)}, stored ${JSON.stringify(data)}`;
      } },
    // A product thrown away whose stock is counted leaves the count too, in
    // the same transaction. The case's own product, never one of the demo's.
    { name: "POST /api/costs/waste (two unsold, off a counted stock of three)", as: "cashier", method: "POST",
      path: "/api/costs/waste",
      arrange: async f => { await f.admin.from("menu_items").update({ stock: 3 }).eq("id", f.costItem); },
      body: f => ({ itemId: f.costItem, quantity: "2", reason: "unsold", note: `${MARK} waste` }),
      expect: [200],
      check: async (d, f) => {
        f.wasteId = d.id;
        const { data } = await f.admin.from("menu_items").select("stock").eq("id", f.costItem).single();
        if (Object.hasOwn(d, "cost")) return "the cashier received a private waste cost";
        return data.stock === 1 || `stock is ${data.stock}, not 1`;
      } },
    { name: "POST /api/costs/waste (no reason)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: (_f, saved) => ({ ingredientId: saved.flour, quantity: "5" }),
      expect: [400], expectError: /por qué se tiró|why it was thrown away/i },
    { name: "POST /api/costs/waste (an ingredient and a product at once)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: (f, saved) => ({ ingredientId: saved.flour, itemId: f.costItem, quantity: "1", reason: "mistake" }),
      expect: [400], expectError: /una cosa que se tiró|one thing that was thrown away/i },
    { name: "POST /api/costs/waste (half a product)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: f => ({ itemId: f.costItem, quantity: "1.5", reason: "mistake" }),
      expect: [400], expectError: /productos completos|whole products/i },
    { name: "DELETE /api/costs/waste (a cashier cannot take one back)", as: "cashier", method: "DELETE",
      path: "/api/costs/waste", body: f => ({ id: f.wasteId }), expect: [403] },
    { name: "DELETE /api/costs/waste (a manager takes it back)", as: "manager", method: "DELETE",
      path: "/api/costs/waste", body: f => ({ id: f.wasteId }), expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("waste_entries").select("id", { count: "exact", head: true }).eq("id", f.wasteId);
        return count === 0 || "the entry is still there";
      } },
    { name: "POST /api/costs/purchases (a cashier refused)", as: "cashier", method: "POST",
      path: "/api/costs/purchases", body: (_f, saved) => ({ ingredientId: saved.flour, packs: "1", total: "20" }), expect: [403] },
    { name: "POST /api/costs/purchases (no packs)", as: "owner", method: "POST",
      path: "/api/costs/purchases", body: (_f, saved) => ({ ingredientId: saved.flour, packs: "0", total: "20" }),
      expect: [400], expectError: /cuántos paquetes|how many packs/i },
    { name: "POST /api/costs/counts (the kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/costs/counts", body: (_f, saved) => ({ counts: [{ ingredientId: saved.flour, counted: "1" }] }), expect: [403] },
    { name: "POST /api/costs/counts (another restaurant's ingredient)", as: "owner", method: "POST",
      path: "/api/costs/counts",
      arrange: async f => {
        const { data: other } = await f.admin.from("restaurants").select("id").neq("id", r).limit(1).maybeSingle();
        const { data } = await f.admin.from("ingredients").insert({
          restaurant_id: other.id, name: `${MARK} neighbour stock`, unit: "g", pack_size: 1000, pack_price: 1, updated_by: MARK,
        }).select("id").single();
        f.foreignStock = data?.id ?? "";
        return () => f.admin.from("ingredients").delete().eq("id", f.foreignStock);
      },
      body: f => ({ counts: [{ ingredientId: f.foreignStock, counted: "1" }] }),
      expect: [404], expectError: /no encontrado|not found/i },
    { name: "PATCH /api/costs/settings (buy for ten days)", as: "manager", method: "PATCH",
      path: "/api/costs/settings", body: { purchaseCoverDays: "10" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("purchase_cover_days, terminal_fee_pct").eq("id", r).single();
        return data.purchase_cover_days === 10 && Number(data.terminal_fee_pct) === 4.25 || `stored ${JSON.stringify(data)}`;
      } },
    { name: "PATCH /api/costs/settings (buy for no days)", as: "owner", method: "PATCH",
      path: "/api/costs/settings", body: { purchaseCoverDays: "0" }, expect: [400],
      expectError: /para cuántos días|how many days to buy/i },
    // A card payment that landed on a bill already collected, given back from
    // Cuentas abiertas. The demo has no real Stripe account, so the healthy
    // answer is Stripe's refusal — and the assertion is the half that matters:
    // a refund Stripe never made is not marked done, so the row stays owed.
    { name: "POST /api/refunds-due (Stripe refuses: the payment stays owed)", as: "manager",
      method: "POST", path: "/api/refunds-due",
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const { data } = await f.admin.from("refunds_due").insert({
          restaurant_id: r, stripe_payment_intent: `pi_${MARK}_${crypto.randomUUID()}`,
          amount: 12.5, table_label: MARK,
        }).select("id").single();
        f.refundDueId = data?.id ?? "";
        return async () => {
          await f.admin.from("refunds_due").delete().eq("id", f.refundDueId);
          await putReaderBack();
        };
      },
      body: f => ({ id: f.refundDueId }),
      expect: [502], expectError: /no hizo el reembolso|did not make the refund/i,
      effect: async f => {
        const { data } = await f.admin
          .from("refunds_due").select("refunded_at").eq("id", f.refundDueId).maybeSingle();
        return data && data.refunded_at === null
          ? true
          : `a refund Stripe never made was marked done (${data?.refunded_at ?? "row gone"})`;
      } },
    { name: "POST /api/refunds-due (one already given back)", as: "manager",
      method: "POST", path: "/api/refunds-due",
      arrange: async f => {
        const { data } = await f.admin.from("refunds_due").insert({
          restaurant_id: r, stripe_payment_intent: `pi_${MARK}_${crypto.randomUUID()}`,
          amount: 12.5, table_label: MARK, refunded_at: new Date().toISOString(),
        }).select("id").single();
        f.refundedId = data?.id ?? "";
        return async () => { await f.admin.from("refunds_due").delete().eq("id", f.refundedId); };
      },
      body: f => ({ id: f.refundedId }),
      expect: [409], expectError: /ya se reembolsó|already refunded/i },
    // The same promise for a refusal that comes before any charge. The table
    // is checked after the coupon is claimed, and that answer once returned
    // without handing the use back: a code with a limit could be spent down
    // to nothing by asking for a table that is not this restaurant's, and a
    // diner whose table was deleted while they ordered lost one quietly.
    { name: "POST /api/checkout (a table that is not here gives back the coupon)", as: "diner",
      method: "POST", path: "/api/checkout",
      body: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        f.couponUsesBefore = data?.uses_count ?? 0;
        return {
          restaurantId: r, tableId: crypto.randomUUID(), payLater: true, note: MARK,
          couponCode: f.cardCouponCode,
          items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price),
                    qty: 5, emoji: "🍽️", mods: {} }],
        };
      },
      expect: [404], expectError: /mesa no encontrada|table not found/i,
      effect: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        return data?.uses_count === f.couponUsesBefore
          ? true
          : `the coupon went from ${f.couponUsesBefore} uses to ${data?.uses_count} on an order refused for its table`;
      } },
    // And one that cannot pass by being refused at the door.
    //
    // The case above accepts 200 OR 409, because with no Stripe account the
    // healthy answer really is 409 — which means it has never once exercised
    // the route's own code. Paying at the counter walks the same path and
    // needs no Stripe, so this is the first case that fails if verifying,
    // pricing or writing the order breaks.
    { name: "POST /api/checkout (pay at the counter)", as: "diner", method: "POST",
      path: "/api/checkout",
      body: { restaurantId: r, tableId: null, payLater: true, note: MARK,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 3,
          emoji: "🍽️", mods: {} }] },
      expect: [200] },
    // Stripe Checkout takes 100 line items and this route makes one per line
    // plus the service charge and the tip, so the cart stops at 98.
    { name: "POST /api/checkout (more lines than Stripe would take)", as: "diner",
      method: "POST", path: "/api/checkout",
      body: { restaurantId: r, tableId: null, payLater: true, note: MARK,
        items: Array.from({ length: 99 }, () => ({ itemId: dish.id, name: dish.name,
          price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} })) },
      expect: [400] },
    { name: "POST /api/receipt", as: "diner", method: "POST", path: "/api/receipt",
      body: { orderId: paidOrder, email: "nobody@tabletap.dev" }, expect: [200, 400, 409, 503] },

    // ── the floor ────────────────────────────────────────────────────────
    { name: "GET  /api/badges", as: "waiter", method: "GET", path: "/api/badges", expect: [200] },
    // The bell. A manager may read it and mark it read; that the floor and the
    // kitchen are refused is checked by `pnpm roles`, which owns the question
    // of who may call what.
    { name: "GET  /api/notifications", as: "manager", method: "GET",
      path: "/api/notifications", expect: [200],
      check: d => Array.isArray(d.notifications) || "did not answer with a list" },
    { name: "POST /api/notifications (all read)", as: "manager", method: "POST",
      path: "/api/notifications", body: { all: true }, expect: [200] },
    { name: "GET  /api/table-bill (table)", as: "waiter", method: "GET",
      path: `/api/table-bill?tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/table-bill (counter)", as: "cashier", method: "GET",
      path: `/api/table-bill?orderId=${unpaidOrder}`, expect: [200],
      check: d => d.orders?.length === 1 || "did not find the counter order" },
    { name: "GET  /api/bill/discount/options", as: "manager", method: "GET",
      path: `/api/bill/discount/options?tableId=${table.id}`, expect: [200] },
    // ── Stations: the bar and the kitchen each finish their part ─────────
    // One order with a drink and a plate. The bar finishing does not make it
    // ready; the kitchen finishing after it does. The floor cannot press it,
    // and a station with nothing in the order cannot either.
    { name: "POST /api/orders/station (the bar finishes its part)", as: "kitchen", method: "POST",
      path: "/api/orders/station",
      body: async f => ({ id: await kitchenTicketId(f, f.stationOrder), station: "bar" }), expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("orders").select("status, stations_ready").eq("id", f.stationOrder).single();
        if (d.status !== "preparing") return `answered ${d.status}, not preparing`;
        return data?.status === "preparing" && JSON.stringify(data.stations_ready) === '["bar"]' || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/orders/station (a waiter cannot press it)", as: "waiter", method: "POST",
      path: "/api/orders/station", body: f => ({ id: f.stationOrder, station: "kitchen" }), expect: [403] },
    { name: "POST /api/orders/station (a station with nothing here)", as: "kitchen", method: "POST",
      path: "/api/orders/station", body: async f => ({ id: await kitchenTicketId(f, f.kitchenOnlyOrder), station: "bar" }), expect: [409],
      expectError: /nada que preparar|nothing to make/i },
    { name: "POST /api/orders/station (the kitchen finishes: the order is ready)", as: "kitchen", method: "POST",
      path: "/api/orders/station", body: async f => ({ id: await kitchenTicketId(f, f.stationOrder), station: "kitchen" }), expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("orders").select("status").eq("id", f.stationOrder).single();
        return d.status === "ready" && data?.status === "ready" || `answered ${d.status}, stored ${data?.status}`;
      } },
    { name: "POST /api/orders/station (an order already ready)", as: "kitchen", method: "POST",
      path: "/api/orders/station", body: async f => ({ id: await kitchenTicketId(f, f.stationOrder), station: "bar" }), expect: [409],
      expectError: /ya avanzó|already moved on/i },
    { name: "PATCH /api/orders (move)", as: "kitchen", method: "PATCH", path: "/api/orders",
      body: async f => ({ id: await kitchenTicketId(f, unpaidOrder), status: "preparing" }), expect: [200] },
    // A move that waited out a dropped connection carries the status it began
    // at. The order is "preparing" by now, so a queued "from: received" is
    // older than the board and must be refused rather than drag it backwards —
    // and the order must still be where the live board put it.
    { name: "PATCH /api/orders (a stale queued move loses)", as: "kitchen", method: "PATCH",
      path: "/api/orders", body: async f => ({ id: await kitchenTicketId(f, unpaidOrder), status: "received", from: "received" }),
      expect: [409], expectError: /ya cambió de etapa|has moved on/i,
      effect: async f => {
        const { data } = await f.admin.from("orders").select("status").eq("id", unpaidOrder).single();
        return data?.status === "preparing" || `a stale move left the order ${data?.status}`;
      } },
    { name: "POST /api/table-payment (counter)", as: "cashier", method: "POST",
      path: "/api/table-payment", body: { orderId: unpaidOrder, settlement: "cash" },
      expect: [200],
      check: async (d, f) => {
        if (d.orders !== 1) return `settled ${d.orders} order(s)`;
        // The order and its money are one write: paid, and in the ledger once.
        const [{ data: order }, { data: rows }] = await Promise.all([
          f.admin.from("orders").select("paid, total").eq("id", unpaidOrder).single(),
          f.admin.from("payments").select("amount, method, actor_email").eq("order_id", unpaidOrder),
        ]);
        if (!order?.paid) return "the order is not marked paid";
        if (rows?.length !== 1) return `${rows?.length ?? 0} payment(s) recorded for it`;
        if (Number(rows[0].amount) !== Number(order.total)) return `recorded MX$${rows[0].amount} of MX$${order.total}`;
        return rows[0].method === "cash" && rows[0].actor_email ? true : "recorded without its method or who took it";
      } },

    // Paid while it waits in "Listos": done, off the board by itself. And only
    // then — a paid order the kitchen is still cooking stays where it is.
    ...[["ready", "completed", "a ready order paid is completed"], ["preparing", "preparing", "an order still cooking stays where it is"]].map(([before, after, what]) => ({
      name: `POST /api/table-payment (${what})`, as: "cashier", method: "POST", path: "/api/table-payment",
      arrange: async f => {
        const { data } = await f.admin.from("orders").insert({
          restaurant_id: r, items: [{ itemId: "x", name: `${MARK} listos`, emoji: "🥗", price: 9, qty: 1, mods: {} }],
          subtotal: 9, service_fee: 0, tip: 0, tax_pct: 0, discount: 0, total: 9, currency: "MXN",
          note: MARK, status: before, paid: false,
        }).select("id").single();
        f.listosOrder = data?.id ?? "";
        return async () => {
          await f.admin.from("payments").delete().eq("order_id", f.listosOrder);
          await f.admin.from("orders").delete().eq("id", f.listosOrder);
        };
      },
      body: f => ({ orderId: f.listosOrder, settlement: "cash" }),
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("orders").select("paid, status").eq("id", f.listosOrder).single();
        if (!data?.paid) return "the order was not paid";
        return data.status === after || `paid while ${before}, it is now ${data.status}, not ${after}`;
      },
    })),

    // ── gerencia ─────────────────────────────────────────────────────────
    // The counter till. A cashier may ring a sale; a waiter may not, and the
    // route says so rather than the screen merely hiding the link.
    { name: "POST /api/pos/order (waiter refused)", as: "waiter", method: "POST",
      path: "/api/pos/order",
      body: { posRef: "00000000-0000-4000-8000-000000000001", method: "cash",
              items: [{ itemId: "00000000-0000-4000-8000-000000000002", qty: 1 }] },
      expect: [403] },
    // ── Customer accounts ("cuenta abierta") ─────────────────────────────
    // In the order a real one lives: opened, its ceiling moved, a table's bill
    // put on it, a charge past the ceiling refused, a sale rung onto it at the
    // till, collected in person, and its statement read by the customer.
    { name: "GET  /api/accounts", as: "cashier", method: "GET", path: "/api/accounts", expect: [200],
      check: d => (Array.isArray(d.accounts) && d.accounts.some(a => a.id === fx.accountId)) || "the gate's account is not listed" },
    { name: "POST /api/accounts (open one)", as: "waiter", method: "POST", path: "/api/accounts",
      body: { name: `${MARK} customer`, limit: 500, email: "cliente@example.com" }, expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("customer_accounts").select("opened_by, credit_limit, code")
          .eq("restaurant_id", f.restaurant.id).eq("name", `${MARK} customer`).maybeSingle();
        if (!data) return "no account was opened";
        if (data.opened_by !== "demo-waiter@tabletap.dev") return `opened by ${data.opened_by}, not the waiter`;
        return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(data.code) || `a code the QR cannot carry: ${data.code}`;
      } },
    { name: "POST /api/accounts (no name)", as: "waiter", method: "POST", path: "/api/accounts",
      body: { name: "  ", limit: 500 }, expect: [400], expectError: /nombre del cliente|customer's name/i },
    { name: "PATCH /api/accounts (a waiter moves a ceiling)", as: "waiter", method: "PATCH", path: "/api/accounts",
      body: { id: fx.accountId, action: "limit", limit: 5000 }, expect: [403] },
    { name: "PATCH /api/accounts (a manager moves a ceiling)", as: "manager", method: "PATCH", path: "/api/accounts",
      body: { id: fx.accountId, action: "limit", limit: 1500 }, expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("customer_accounts").select("credit_limit").eq("id", fx.accountId).single();
        return Number(data.credit_limit) === 1500 || `the ceiling is ${data.credit_limit}`;
      } },
    { name: "POST /api/accounts/charge (a table's bill)", as: "waiter", method: "POST", path: "/api/accounts/charge",
      body: { accountId: fx.accountId, orderIds: [fx.acctOrder], expected: fx.lineTotal }, expect: [200],
      effect: async f => {
        const { data: o } = await f.admin.from("orders").select("account_id, paid, charged_by").eq("id", fx.acctOrder).single();
        if (o.account_id !== fx.accountId || o.paid) return `the order is ${JSON.stringify(o)}`;
        if (o.charged_by !== "demo-waiter@tabletap.dev") return `charged by ${o.charged_by}`;
        const { data: s } = await f.admin.from("table_sessions").select("close_reason").eq("id", fx.acctSessionId).single();
        return s.close_reason === "account" || `the table's sitting closed as ${s.close_reason}`;
      } },
    { name: "POST /api/accounts/charge (past the ceiling)", as: "waiter", method: "POST", path: "/api/accounts/charge",
      arrange: async f => {
        await f.admin.from("customer_accounts").update({ credit_limit: fx.lineTotal + 0.01 }).eq("id", fx.accountId);
        return async () => { await f.admin.from("customer_accounts").update({ credit_limit: 1500 }).eq("id", fx.accountId); };
      },
      body: { accountId: fx.accountId, orderIds: [fx.acctOrder2], expected: fx.lineTotal }, expect: [409],
      expectError: /límite|limit/i,
      effect: async f => {
        const { data } = await f.admin.from("orders").select("account_id").eq("id", fx.acctOrder2).single();
        return data.account_id === null || "the refused charge went on the account anyway";
      } },
    { name: "POST /api/pos/order (on an account)", as: "cashier", method: "POST", path: "/api/pos/order",
      body: { posRef: crypto.randomUUID(), method: "account", accountId: fx.accountId, note: MARK,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} }] },
      expect: [200], check: d => Boolean(d.onAccount?.owed > 0) || `no account in ${JSON.stringify(d).slice(0, 80)}`,
      effect: async f => {
        const { data } = await f.admin.from("payments").select("id").eq("account_id", fx.accountId);
        return (data ?? []).length === 0 || "a sale on account recorded money that never arrived";
      } },
    { name: "POST /api/accounts/settle (the balance changed)", as: "cashier", method: "POST", path: "/api/accounts/settle",
      body: { accountId: fx.accountId, expected: 0.5, tip: 0, method: "cash" }, expect: [409],
      expectError: /cambió|changed/i },
    { name: "POST /api/accounts/settle (cash, with a tip)", as: "cashier", method: "POST", path: "/api/accounts/settle",
      body: async f => {
        const { data } = await f.admin.from("orders").select("total")
          .eq("account_id", fx.accountId).eq("paid", false).neq("status", "cancelled");
        f.accountOwed = Math.round((data ?? []).reduce((s, o) => s + Number(o.total), 0) * 100) / 100;
        return { accountId: fx.accountId, expected: f.accountOwed, tip: 10, method: "cash", ref: crypto.randomUUID() };
      },
      expect: [200],
      effect: async f => {
        const [{ data: pays }, { data: owed }] = await Promise.all([
          f.admin.from("payments").select("amount, tip, method, actor_email").eq("account_id", fx.accountId),
          f.admin.from("orders").select("id").eq("account_id", fx.accountId).eq("paid", false).neq("status", "cancelled"),
        ]);
        if ((pays ?? []).length !== 1) return `${(pays ?? []).length} payments for one collection`;
        const [p] = pays;
        if (Math.abs(Number(p.amount) - (f.accountOwed + 10)) > 0.01 || Number(p.tip) !== 10) return `paid ${p.amount} with tip ${p.tip}`;
        if (p.actor_email !== "demo-cashier@tabletap.dev") return `the drawer is ${p.actor_email}'s`;
        return (owed ?? []).length === 0 || "orders still owed after the account was paid";
      } },
    { name: "GET  /api/account (a statement)", as: "diner", method: "GET", path: `/api/account?c=${fx.accountCode}`,
      expect: [200],
      check: d => {
        if (typeof d.owed !== "number" || !Array.isArray(d.days)) return `no statement in ${JSON.stringify(d).slice(0, 80)}`;
        const said = JSON.stringify({ ...d, restaurant: { ...d.restaurant, id: undefined } });
        if (said.includes("@")) return "the statement names somebody's email";
        if (/credit_limit|opened_by/.test(said)) return "the statement hands out the ceiling or who opened it";
        return !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(said) || "the statement hands out a row id";
      } },
    { name: "GET  /api/account (no such account)", as: "diner", method: "GET", path: "/api/account?c=000000000000",
      expect: [404], expectError: /encontramos|couldn't find/i },
    // The demo has no card reader: refused before any hold is put on.
    { name: "POST /api/account/pay (no card reader)", as: "diner", method: "POST", path: "/api/account/pay",
      body: { c: fx.accountCode, expected: 1 }, expect: [409], expectError: /tarjeta|card/i },
    // Dev carries a placeholder mail key, so a real send fails there: either
    // answer is one the route gives, and neither keeps the address.
    { name: "POST /api/account/email (the statement)", as: "diner", method: "POST", path: "/api/account/email",
      body: { c: fx.accountCode, email: "cliente@example.com" }, expect: [200, 409, 502] },
    // ── A tier without the feature: saved discounts stop ─────────────────
    // Promotions and coupons made on a tier that had them stay saved after a
    // move down, and used to go on discounting every sale. Each refusal has a
    // control on the demo's own tier first, so it cannot pass merely because
    // the request was malformed.
    { name: "POST /api/coupons/validate (a coupon the tier carries)", as: "diner", method: "POST",
      path: "/api/coupons/validate", body: async f => ({ restaurantId: r, code: f.cardCouponCode, subtotal: 1000 }),
      expect: [200], check: d => d.valid === true || `answered ${JSON.stringify(d).slice(0, 80)}` },
    { name: "POST /api/coupons/validate (a coupon on a tier without coupons)", as: "diner", method: "POST",
      path: "/api/coupons/validate", arrange: f => f.onCarta(),
      body: async f => ({ restaurantId: r, code: f.cardCouponCode, subtotal: 1000 }),
      expect: [200], check: d => (d.valid === false && d.reason === "notFound") || `answered ${JSON.stringify(d).slice(0, 80)}` },
    { name: "POST /api/checkout (a coupon on a tier without coupons)", as: "diner", method: "POST",
      path: "/api/checkout",
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const putPlanBack = await f.onCarta();
        return async () => { await putPlanBack(); await putReaderBack(); };
      },
      body: async f => ({ restaurantId: r, tableId: null, note: MARK, couponCode: f.cardCouponCode,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 5, emoji: "🍽️", mods: {} }] }),
      expect: [409], check: d => d.couponReason === "notFound" || `answered ${JSON.stringify(d).slice(0, 80)}` },
    // The control goes as far as Stripe, which refuses the fake account: the
    // combo passed every check before it.
    { name: "POST /api/checkout (a combo the tier carries)", as: "diner", method: "POST",
      path: "/api/checkout", arrange: f => f.withCardReader(),
      body: async f => ({ restaurantId: r, tableId: null, note: MARK, items: [f.combo] }),
      expect: [500], expectError: /pago falló|payment failed/i },
    { name: "POST /api/checkout (a combo on a tier without promotions)", as: "diner", method: "POST",
      path: "/api/checkout",
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const putPlanBack = await f.onCarta();
        return async () => { await putPlanBack(); await putReaderBack(); };
      },
      body: async f => ({ restaurantId: r, tableId: null, note: MARK, items: [f.combo] }),
      expect: [400], expectError: /ya no está disponible|no longer available/i },
    // ── Caja: the register on its own ────────────────────────────────────
    // A diner's phone cannot check out — the order is taken at the register —
    // and the route says the same sentence the menu does.
    { name: "POST /api/checkout (Caja takes the order at the register)", as: "diner", method: "POST",
      path: "/api/checkout", arrange: f => f.onCaja(),
      body: { restaurantId: r, tableId: null, payLater: true, note: MARK,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1,
          emoji: "🍽️", mods: {} }] },
      expect: [409], expectError: /toma los pedidos en la caja|takes orders at the register/i },
    // No kitchen board and no tables, so no login for a cook: refused with the
    // tier that has one, before any invite is sent.
    { name: "POST /api/staff (a cook on Caja)", as: "owner", method: "POST", path: "/api/staff",
      arrange: f => f.onCaja(), body: { email: "demo-waiter@tabletap.dev", role: "kitchen" },
      expect: [403], expectError: /cocina y meseros|kitchen and waiter/i },
    // Served where it is paid: with no board to wait on, the sale is finished
    // the moment it is rung.
    { name: "POST /api/pos/order (Caja: served where it is paid)", as: "cashier", method: "POST",
      path: "/api/pos/order", arrange: f => f.onCaja(),
      body: { posRef: crypto.randomUUID(), method: "cash", note: `${MARK} caja`,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1,
          emoji: "🍽️", mods: {} }] },
      expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("orders").select("id, status, paid, total")
          .eq("restaurant_id", f.restaurant.id).eq("note", `${MARK} caja`).maybeSingle();
        if (!(data?.status === "completed" && data?.paid === true)) {
          return `the sale is ${data?.status ?? "missing"}, paid=${data?.paid}`;
        }
        // Rung and recorded as one write: the sale has exactly its money.
        const { data: rows } = await f.admin.from("payments").select("amount, method, actor_email").eq("order_id", data.id);
        if (rows?.length !== 1) return `${rows?.length ?? 0} payment(s) recorded for the sale`;
        return Number(rows[0].amount) === Number(data.total) && rows[0].method === "cash" && rows[0].actor_email
          ? true
          : `recorded ${JSON.stringify(rows[0])} for a MX$${data.total} sale`;
      } },
    // A card on the restaurant's own terminal, with the voucher's
    // authorization number kept on the payment to find the sale later. The
    // sale and its money go again after the case, the payment first.
    { name: "POST /api/pos/order (a card on the terminal, with its voucher)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      arrange: f => async () => {
        const { data: sales } = await f.admin.from("orders").select("id")
          .eq("restaurant_id", f.restaurant.id).eq("note", `${MARK} terminal`);
        const ids = (sales ?? []).map(o => o.id);
        if (ids.length) {
          await f.admin.from("payments").delete().in("order_id", ids);
          await f.admin.from("orders").delete().in("id", ids);
        }
      },
      body: { posRef: crypto.randomUUID(), method: "card", note: `${MARK} terminal`, terminalRef: "  AUTH 482913 ",
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} }] },
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("payments").select("method, terminal_ref, stripe_payment_intent").eq("order_id", d.orderId);
        return data?.length === 1 && data[0].method === "card" && data[0].terminal_ref === "AUTH 482913"
          && data[0].stripe_payment_intent === null || `recorded ${JSON.stringify(data)}`;
      } },
    terminalDepositRace(),
    // The terminal's deposits, on a day the demo took cards on its terminal.
    { name: "POST /api/terminal/deposits (a day's deposit arrived short)", as: "manager", method: "POST",
      path: "/api/terminal/deposits",
      // The most recent day the terminal took cards that nobody has marked
      // yet — the seed marks the older ones, as a café that reconciles would.
      arrange: async f => {
        const since = new Date(Date.now() - 10 * 86_400_000).toISOString();
        const day = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: f.restaurant.timezone ?? "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
        const [{ data: paid }, { data: marked }] = await Promise.all([
          f.admin.from("payments").select("created_at").eq("restaurant_id", r).eq("currency", f.restaurant.currency).eq("method", "card")
            .is("stripe_payment_intent", null).gte("created_at", since).order("created_at", { ascending: false }),
          f.admin.from("terminal_deposits").select("sales_day").eq("restaurant_id", r).eq("currency", f.restaurant.currency),
        ]);
        const taken = new Set((marked ?? []).map(d => d.sales_day));
        f.depositDay = (paid ?? []).map(p => day(p.created_at)).find(d => !taken.has(d)) ?? "";
      },
      body: f => ({ day: f.depositDay, currency: f.restaurant.currency, received: "100.00", note: `${MARK} deposit` }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("terminal_deposits").select("expected, received, recorded_by")
          .eq("restaurant_id", r).eq("sales_day", f.depositDay).eq("currency", f.restaurant.currency).single();
        return Number(data.received) === 100 && Number(data.expected) === Number(d.expected) && Number(d.expected) > 0
          && data.recorded_by === "demo-manager@tabletap.dev" || `stored ${JSON.stringify(data)}, answered ${JSON.stringify(d)}`;
      } },
    { name: "POST /api/terminal/deposits (the same day twice)", as: "owner", method: "POST",
      path: "/api/terminal/deposits", body: f => ({ day: f.depositDay, currency: f.restaurant.currency, received: "1" }),
      expect: [409], expectError: /ya está marcado|already marked/i },
    { name: "POST /api/terminal/deposits (a day with no terminal sales)", as: "owner", method: "POST",
      path: "/api/terminal/deposits", body: f => ({ day: "2001-01-01", currency: f.restaurant.currency, received: "1" }),
      expect: [404], expectError: /no hubo cobros|no card payments/i },
    { name: "POST /api/terminal/deposits (a cashier refused)", as: "cashier", method: "POST",
      path: "/api/terminal/deposits", body: f => ({ day: f.depositDay, currency: f.restaurant.currency, received: "1" }), expect: [403] },
    { name: "DELETE /api/terminal/deposits (taken back)", as: "manager", method: "DELETE",
      path: "/api/terminal/deposits", body: f => ({ day: f.depositDay, currency: f.restaurant.currency }), expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("terminal_deposits").select("id", { count: "exact", head: true })
          .eq("restaurant_id", r).eq("sales_day", f.depositDay).eq("currency", f.restaurant.currency);
        return count === 0 || "the deposit is still marked";
      } },
    { name: "PATCH /api/terminal/deposits (the bank takes two business days)", as: "owner", method: "PATCH",
      path: "/api/terminal/deposits", body: { settleDays: "2" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("terminal_settle_days").eq("id", r).single();
        return data.terminal_settle_days === 2 || `stored ${data.terminal_settle_days}`;
      } },
    { name: "PATCH /api/terminal/deposits (eleven days)", as: "manager", method: "PATCH",
      path: "/api/terminal/deposits", body: { settleDays: "11" }, expect: [400],
      expectError: /de 0 a 10|from 0 to 10/i },
    ...offlineCases(fx),
    { name: "POST /api/pos/order (no cart)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      body: { posRef: "00000000-0000-4000-8000-000000000003", method: "cash", items: [] },
      // An empty sale is refused before anything is priced or reserved.
      expect: [400, 403] },
    // The printer's address is a credential: a manager may mint one, a cashier
    // may not, and a wrong one is told nothing it did not already know.
    { name: "POST /api/print/token (cashier refused)", as: "cashier", method: "POST",
      path: "/api/print/token", expect: [403] },
    { name: "POST /api/print/token", as: "manager", method: "POST", path: "/api/print/token",
      expect: [200],
      check: d => (typeof d.token === "string" && d.token.length >= 40) || "returned no token" },
    { name: "POST /api/print/cloudprnt (wrong address)", as: "diner", method: "POST",
      path: "/api/print/cloudprnt/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", expect: [200],
      // Not an error, and not a hint: the same "nothing waiting" a real
      // printer gets on a quiet counter.
      check: d => d.jobReady === false || "a wrong address was offered a job" },
    { name: "GET  /api/print/cloudprnt (wrong address)", as: "diner", method: "GET",
      path: "/api/print/cloudprnt/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", expect: [404] },
    { name: "DELETE /api/print/cloudprnt (wrong address)", as: "diner", method: "DELETE",
      path: "/api/print/cloudprnt/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", expect: [404] },
    // And the other half, which nothing checked: that a RIGHT address works.
    // Both cases above are satisfied by a route that refuses everyone, and for
    // a while that is exactly what any change to this file would have produced
    // without a word — the seed configured no printer, so there was no token
    // to call it with.
    { name: "POST /api/print/cloudprnt (the printer's own address)", as: "diner",
      method: "POST", path: async f => `/api/print/cloudprnt/${await f.printToken()}`, expect: [200],
      check: d => d.jobReady === true || "a real printer with a ticket waiting was told the counter was quiet" },
    { name: "GET  /api/print/cloudprnt (collects its ticket)", as: "diner", method: "GET",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}`, expect: [200],
      // Plain text, not JSON: this is what comes out on paper.
      checkText: t => (t.includes(MARK) || t.length > 20) || `the paper came out empty: ${JSON.stringify(t.slice(0, 40))}`,
      // A kitchen ticket is dishes. A printer is not a login, and money has no
      // business on a roll of paper in a corridor.
      },
    { name: "GET  /api/print/cloudprnt (no money on the paper)", as: "diner", method: "GET",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}`, expect: [200],
      checkText: t => !/MX\$|tarjeta|\bcard\b|total:/i.test(t) || "the kitchen ticket carries money" },
    { name: "DELETE /api/print/cloudprnt (closes the job it was handed)", as: "diner",
      method: "DELETE",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}?token=${f.printJobId}`,
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin
          .from("print_jobs").select("printed_at").eq("id", f.printJobId).maybeSingle();
        return data?.printed_at ? true : "the ticket came out and the job stayed open — it would reprint for ever";
      } },
    // A waiter takes an order at a table. Unpaid: the table settles at the end.
    // `note: MARK` is not decoration: teardown deletes orders by that note, so a
    // case that places one without it leaves it behind for good. This one did,
    // every run, and the kitchen ticket with it.
    { name: "POST /api/table-order", as: "waiter", method: "POST", path: "/api/table-order",
      body: { tableId: table.id, note: MARK, items: [{ itemId: dish.id, name: dish.name,
        emoji: dish.emoji, price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [200, 403],
      // 403 when the tier does not carry it; 200 says it landed owing.
      check: d => !d.orderId || Number(d.total) > 0 || "created an order that owes nothing" },
    { name: "POST /api/table-order (kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/table-order",
      body: { tableId: table.id, items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
        price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [403] },
    { name: "POST /api/table-order (cashier refused — they have the till)", as: "cashier",
      method: "POST", path: "/api/table-order",
      body: { tableId: table.id, items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
        price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [403] },
    { name: "POST /api/table-order (no table)", as: "waiter", method: "POST",
      path: "/api/table-order",
      body: { items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
        price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [400] },
    { name: "POST /api/table-order (another restaurant's table)", as: "waiter", method: "POST",
      path: "/api/table-order",
      body: { tableId: "00000000-0000-4000-8000-000000000000",
        items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
          price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [404, 403] },

    // Paper for an order that already exists, from the board or the history.
    { name: "POST /api/orders/print (kitchen, no printer)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await anyOrderId(f), to: "kitchen" }),
      // A restaurant with no printer address must be told, not queued for a
      // machine that will never ask. 200 once one is configured.
      expect: [200, 409] },
    { name: "POST /api/orders/print (kitchen cannot print receipts)", as: "kitchen", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await kitchenTicketId(f, f.printableOrder), to: "receipt" }),
      expect: [403],
      effect: async f => {
        const { data, error } = await f.admin.from("print_jobs").select("printed_at")
          .eq("id", f.printJobId).single();
        return !error && data?.printed_at !== null || "the receipt refusal re-armed the kitchen job";
      } },
    { name: "POST /api/orders/print (kitchen reprint still works)", as: "kitchen", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await kitchenTicketId(f, f.printableOrder), to: "kitchen" }),
      expect: [200], check: d => d.queued === true && !d.html || "no kitchen ticket was queued",
      effect: async f => {
        const { data } = await f.admin.from("print_jobs").select("claimed_at, printed_at")
          .eq("order_id", f.printableOrder).eq("kind", "kitchen").single();
        return data && data.claimed_at === null && data.printed_at === null || "the print job was not re-armed";
      } },
    { name: "POST /api/orders/print (receipt)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await anyOrderId(f), to: "receipt" }),
      expect: [200],
      check: d => (typeof d.html === "string" && d.html.length > 40) || "returned no receipt" },
    { name: "POST /api/orders/print (another restaurant's order)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: { orderId: "00000000-0000-4000-8000-000000000000", to: "receipt" },
      expect: [404] },
    { name: "POST /api/orders/print (bad target)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await anyOrderId(f), to: "wherever" }),
      expect: [400] },
    { name: "POST /api/settings", as: "manager", method: "POST", path: "/api/settings",
      body: { accepting_orders: true }, expect: [200] },
    // Switching the service charge off takes it off an open bill nobody has
    // started paying. The live demo owed MX$4.40 for a MX$4.00 salad after the
    // owner had switched it off: the charge was stored when it was ordered.
    { name: "POST /api/settings (service off takes it off an open bill)", as: "owner", method: "POST",
      path: "/api/settings", arrange: f => f.withServicedOrder(), body: { service_enabled: false },
      expect: [200],
      effect: async f => {
        const { data } = await f.admin
          .from("orders").select("service_fee, total").eq("id", f.servicedOrder.id).maybeSingle();
        return Number(data?.service_fee) === 0 && Number(data?.total) === 4
          ? true
          : `the open bill still owes ${data?.total} with a service charge of ${data?.service_fee}`;
      } },
    { name: "POST /api/coupons (create)", as: "manager", method: "POST", path: "/api/coupons",
      body: { code: "API-001", kind: "percent", value: 10 }, expect: [200] },
    { name: "PATCH /api/coupons (switch off)", as: "manager", method: "PATCH", path: "/api/coupons",
      body: async f => ({ id: await couponId(f), active: false }), expect: [200] },
    { name: "DELETE /api/coupons", as: "manager", method: "DELETE", path: "/api/coupons",
      body: async f => ({ id: await couponId(f) }), expect: [200] },
    { name: "POST /api/dietary-tags (create)", as: "manager", method: "POST", path: "/api/dietary-tags",
      body: { label: `${MARK} diet`, labelEn: "apicheck diet", emoji: "🍬" },
      expect: [200], check: d => Boolean(d.id) || "returned no tag id" },
    { name: "PATCH /api/dietary-tags (rename)", as: "manager", method: "PATCH", path: "/api/dietary-tags",
      body: async f => ({ id: await dietaryTagId(f), label: `${MARK} diet`, emoji: "🍭" }),
      expect: [200] },
    { name: "DELETE /api/dietary-tags", as: "manager", method: "DELETE", path: "/api/dietary-tags",
      body: async f => ({ id: await dietaryTagId(f) }), expect: [200] },
    { name: "POST /api/icon-groups (create)", as: "manager", method: "POST", path: "/api/icon-groups",
      body: { name: `${MARK} icons`, variant: "addon", icons: [{ emoji: "🌮" }, { emoji: "🌶️" }] },
      expect: [200], check: d => Boolean(d.id) || "returned no icon group id" },
    { name: "PATCH /api/icon-groups (rename)", as: "manager", method: "PATCH", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f), name: `${MARK} icons`, icons: [{ emoji: "🧄" }] }),
      expect: [200] },
    { name: "DELETE /api/icon-groups", as: "manager", method: "DELETE", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f) }), expect: [200] },
    { name: "POST /api/promotions (create)", as: "manager", method: "POST", path: "/api/promotions",
      body: { kind: "bogo", name: `${MARK} 2x1`, emoji: "🎁", buyQty: 2, payQty: 1,
              items: [{ itemId: dish.id, qty: 1 }] }, expect: [200] },
    { name: "POST /api/legal/accept", as: "owner", method: "POST", path: "/api/legal/accept",
      body: {}, expect: [200] },
    { name: "GET  /api/connect/status", as: "owner", method: "GET", path: "/api/connect/status",
      expect: [200] },

    // ── the bill: discount, cancel, collect ──────────────────────────────
    // This asked for API-002, which has never existed anywhere. API-001 does,
    // briefly — the gate mints it, switches it off and deletes it, all before
    // this runs. So the waiter was told "no encontramos ese cupón", and the
    // chain behind it died quietly: no discount request was ever left, so the
    // manager's approval had nothing to approve and answered 400 for four
    // statuses' worth of permission.
    { name: "POST /api/bill/discount (waiter asks)", as: "waiter", method: "POST",
      path: "/api/bill/discount",
      body: async f => ({ tableId: f.discountTableId, code: f.discountCode }),
      expect: [200] },
    { name: "POST /api/bill/discount/approve", as: "manager", method: "POST",
      path: "/api/bill/discount/approve",
      // The manager approves the amount the ask shows, and nothing else.
      body: async f => {
        const requestId = await pendingDiscount(f);
        const { data } = await f.admin.from("discount_requests").select("amount").eq("id", requestId).maybeSingle();
        return { requestId, approve: true, reviewedAmount: Number(data?.amount) };
      },
      // There is a request pending now, so this approves one — and a 200 that
      // took nothing off the bill is the failure this gate exists to catch.
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin
          .from("orders").select("discount, coupon_code").eq("id", f.discountOrder).maybeSingle();
        return Number(data?.discount) > 0
          ? true
          : `approved, and the order still shows a discount of ${data?.discount}`;
      } },
    twoSittingCollection(),
    // The calculator: a waiter collects part of a table's bill. A little of
    // it, so the bill stays open for the cases below.
    { name: "POST /api/table-payment/part", as: "waiter", method: "POST",
      path: "/api/table-payment/part",
      body: { tableId: table.id, amount: PART_AMOUNT, tip: PART_TIP, method: "cash", ref: partRef },
      expect: [200],
      // The gratuity is collected but never counts towards the food: a table
      // that tipped must not look nearer to settled than it is.
      check: d =>
        (d.collected >= PART_AMOUNT && d.tips >= PART_TIP && d.owed > 0 && d.settled === false) ||
        `collected ${d.collected}, tips ${d.tips}, owed ${d.owed}` },
    // The same collection again — a button tapped twice on a phone that seemed
    // not to respond. It must land in the ledger once.
    { name: "POST /api/table-payment/part (the same tap twice)", as: "waiter", method: "POST",
      path: "/api/table-payment/part",
      body: { tableId: table.id, amount: PART_AMOUNT, tip: PART_TIP, method: "cash", ref: partRef },
      expect: [200],
      check: d => d.duplicate === true || "the same collection was recorded twice" },
    // A gratuity larger than the money it is thanking somebody for.
    //
    // `applyPayment` caps the tip at the amount collected, the same ceiling the
    // card routes use, so a mistyped MX$50 on a small collection is not cash
    // somebody has to explain at the end of the night. The pure function is
    // tested; nothing checked that the ROUTE honours it — and the comment
    // above the call used to say the tip was not capped at all, which is what
    // sent me looking.
    { name: "POST /api/table-payment/part (a tip bigger than the payment)",
      as: "waiter", method: "POST", path: "/api/table-payment/part",
      body: async f => ({
        tableId: f.billTableId, amount: 1, tip: 500, method: "cash",
        ref: `${MARK}-bigtip-${Date.now()}`,
      }),
      expect: [200],
      effect: async f => {
        const { data } = await f.admin
          .from("payments").select("amount")
          .eq("restaurant_id", f.restaurant.id)
          .like("client_ref", `${MARK}-bigtip-%`);
        const landed = (data ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
        // MX$1 of food and at most MX$1 of tip. Never MX$501.
        return landed > 0 && landed <= 2.005
          ? true
          : `a MX$1 collection with a MX$500 tip put ${landed} on the ledger`;
      } },
    { name: "POST /api/table-payment/part (kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/table-payment/part",
      body: { tableId: table.id, amount: PART_AMOUNT, method: "cash", ref: `${partRef}-k` },
      expect: [403] },
    { name: "POST /api/bill/write-off (waiter asks)", as: "waiter", method: "POST",
      path: "/api/bill/write-off", body: { tableId: table.id, reason: "walkout", note: MARK },
      expect: [200], check: d => d.pending === true || "a waiter's request should stay pending" },
    // The route reads `requestId`. This sent `id`, so it was refused on the
    // missing field every single run — the one path that decides whether a
    // restaurant absorbs a walkout had never executed.
    { name: "POST /api/bill/write-off/approve (refused)", as: "manager", method: "POST",
      path: "/api/bill/write-off/approve",
      // The id is remembered on the fixture so the check asks about the one
      // that was actually decided. "Is anything still pending?" is a different
      // question, and the answer is yes whenever another case has left one.
      body: async f => {
        f.decidedWriteOff = await pendingWriteOff(f);
        return { requestId: f.decidedWriteOff, approve: false };
      },
      expect: [200],
      check: async (_d, f) => {
        if (!f.decidedWriteOff) return "there was no request to decide";
        const { data } = await f.admin
          .from("write_off_requests").select("status").eq("id", f.decidedWriteOff).maybeSingle();
        return data && data.status !== "pending"
          ? true
          : `decided, and it is still "${data?.status ?? "gone"}"`;
      } },
    // A manager cancels what the table owes, and the table is CLEAR after it:
    // not just unpaid-and-written-off in the ledger, but off the kitchen board
    // and off the diner's phone. It used to leave every order at "received",
    // so the pass still had tickets for a table that had gone and the menu
    // still offered "follow your order ORD-09BB" three times over — on a table
    // the floor had just cleared for the next party.
    { name: "POST /api/bill/write-off (manager clears the table)", as: "manager", method: "POST",
      path: "/api/bill/write-off",
      body: { orderIds: [walkoutOrder], reason: "walkout", note: MARK },
      expect: [200],
      check: async (d, fx) => {
        if (d.pending) return "a manager's write-off should not need approving";
        const { data: o } = await fx.admin
          .from("orders").select("status, written_off").eq("id", walkoutOrder).single();
        if (!o?.written_off) return "the order was not written off";
        // Off the kitchen board and off the diner's phone, not merely marked in
        // the ledger. It used to stay at "preparing": the pass still had a
        // ticket for a table that had gone, and the menu still offered "follow
        // your order" on a table the floor had cleared for the next party.
        return ["completed", "cancelled"].includes(o.status)
          || `written off but still live on the board as "${o.status}"`;
      } },
    { name: "POST /api/orders/cancel", as: "owner", method: "POST", path: "/api/orders/cancel",
      body: { id: tableOrder }, expect: [200] },
    // On an account the customer is paying online: Stripe will charge the
    // orders the payment opened for, so one cancelled in between would be
    // paid for anyway. Refused until the payment lands or runs out.
    { name: "POST /api/orders/cancel (an account being paid online)", as: "owner", method: "POST",
      path: "/api/orders/cancel",
      arrange: async f => {
        await f.admin.from("orders").update({ account_id: fx.accountId }).eq("id", fx.acctOrder2);
        await f.admin.from("customer_accounts")
          .update({ checkout_until: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", fx.accountId);
        return async () => {
          await f.admin.from("customer_accounts").update({ checkout_until: null }).eq("id", fx.accountId);
          await f.admin.from("orders").update({ account_id: null }).eq("id", fx.acctOrder2);
        };
      },
      body: { id: fx.acctOrder2 }, expect: [409], expectError: /pago en línea|online payment/i,
      effect: async f => {
        const { data } = await f.admin.from("orders").select("status").eq("id", fx.acctOrder2).single();
        return data.status !== "cancelled" || "the order was cancelled while its account was being paid";
      } },
    // Cash is not a card that has not settled yet. Treating it as one made a
    // cash sale impossible to cancel — the owner was told "payment is still
    // settling, try again" for ever, on an order the board kept showing, while
    // the screen offered to refund it.
    { name: "GET  /api/orders/cancel (cash: a person gives it back)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.cashPaidOrder}`, expect: [200],
      check: (d, f) => (d.cash === f.linePrice && d.refund === 0) || `answered ${JSON.stringify(d)}` },
    { name: "POST /api/orders/cancel (paid in cash)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.cashPaidOrder }), expect: [200],
      check: async (_d, f) => {
        const { data: o } = await f.admin
          .from("orders").select("status").eq("id", f.cashPaidOrder).maybeSingle();
        if (o?.status !== "cancelled") return `answered 200 and left it "${o?.status}"`;
        // The money genuinely arrived, so the payment stays. The ledger expects
        // exactly this: its check for money against an unsettled order skips
        // cancelled ones on purpose.
        const { data: paid } = await f.admin
          .from("payments").select("amount").eq("order_id", f.cashPaidOrder);
        if (!paid?.length) return "the cancel took the cash payment off the ledger with it";
        const back = await returnFor(f, f.cashPaidOrder);
        return back?.source === "cash" && back.status === "pending" && Number(back.amount) === Number(paid[0].amount)
          || "the cancellation did not reserve a pending cash return";
      } },
    { name: "POST /api/order-refunds (manager confirms cash actually returned)", as: "owner", method: "POST",
      path: "/api/order-refunds", body: async f => ({ id: (await returnFor(f, f.cashPaidOrder))?.id, confirmReturned: true, drawer: "original" }), expect: [200],
      check: async (d, f) => {
        const back = await returnFor(f, f.cashPaidOrder);
        return d.completed && back?.status === "succeeded" && back.confirmed_by === "demo@tabletap.dev" && back.payout_actor === "demo@tabletap.dev"
          || "the return was not confirmed with its manager and payout drawer";
      } },

    // What the dialog asks before it words its offer. Each answer is the one
    // the POST below then acts on — the two read the same plan.
    { name: "GET /api/orders/cancel (paid flag without receipt needs attribution)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.sittingPaidOrder}`, expect: [409], expectError: /atribuy|attribution/i },
    { name: "GET  /api/orders/cancel (POS card: the terminal, not Stripe)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.posCardOrder}`, expect: [200],
      check: (d, f) => (d.terminal === f.linePrice && d.refund === 0) || `answered ${JSON.stringify(d)}` },
    { name: "GET  /api/orders/cancel (a table's online bill: Stripe)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.tableBillOrder}`, expect: [200],
      check: (d, f) => (d.withTable === f.linePrice && d.refund === 0) || `answered ${JSON.stringify(d)}` },
    { name: "GET  /api/orders/cancel (waiter refused)", as: "waiter", method: "GET",
      path: f => `/api/orders/cancel?id=${f.posCardOrder}`, expect: [403] },
    // Card on the restaurant's own terminal. This answered "payment still
    // settling — try again" for ever, while the dialog promised a refund.
    { name: "POST /api/orders/cancel (POS card sale)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.posCardOrder }), expect: [200],
      check: async (_d, f) => {
        const back = await returnFor(f, f.posCardOrder);
        return back?.source === "terminal" && back.status === "pending" && Number(back.amount) === f.linePrice
          || "the terminal return was not reserved pending confirmation";
      } },
    // The receipt predates a verified connected-account snapshot. Cancelling
    // preserves an explicit review obligation rather than guessing an account.
    { name: "POST /api/orders/cancel (unverified Stripe provenance needs review)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.tableBillOrder }), expect: [200],
      effect: async f => {
        const back = await returnFor(f, f.tableBillOrder);
        return back?.status === "review" && back.source === "review" || "the old charge's account was guessed";
      } },
    { name: "POST /api/orders/cancel (unattributed historical paid flag)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.sittingPaidOrder }), expect: [409], expectError: /atribuy|attribution/i },
    // This case sent no orderIds, so it was refused at the body check and never
    // reached a line of the route — while `expect: [200, 400, 409]` accepted
    // that refusal, the no-card-reader one, and a success, all as a pass. It is
    // the route from the Mesa 10 bill: twelve people, "Error de red", and the
    // diner pressing pay again.
    { name: "POST /api/bill/pay (nothing to settle)", as: "diner", method: "POST",
      path: "/api/bill/pay", body: { restaurantId: r, tableId: table.id },
      expect: [400], expectError: /inválida|invalid/i },
    { name: "POST /api/bill/pay (no card reader)", as: "diner", method: "POST",
      path: "/api/bill/pay",
      body: async f => ({ restaurantId: r, tableId: f.billTableId, orderIds: [f.billOrder] }),
      expect: [409], expectError: /tarjeta|card payments/i },
    // The whole route, as far as Stripe. A fake account answers 502, and that
    // is the assertion: everything before it ran — the waiter and split
    // guards, the orders query scoped by restaurant AND table, the coupon
    // rules, the order-count cap and the metadata packing that #333 changed.
    { name: "POST /api/bill/pay (reaches Stripe with a real bill)", as: "diner",
      method: "POST", path: "/api/bill/pay", arrange: f => f.withCardReader(),
      body: async f => ({ restaurantId: r, tableId: f.billTableId, orderIds: [f.billOrder] }),
      expect: [502], expectError: /cobro|checkout|pago/i },
    { name: "POST /api/bill/pay (more orders than one bill can name)", as: "diner",
      method: "POST", path: "/api/bill/pay", arrange: f => f.withCardReader(),
      body: async f => ({
        restaurantId: r, tableId: f.billTableId,
        orderIds: Array.from({ length: 201 }, () => f.billOrder),
      }),
      expect: [400], expectError: /inválida|invalid/i },
    { name: "POST /api/bill/pay (another restaurant's table)", as: "diner",
      method: "POST", path: "/api/bill/pay", arrange: f => f.withCardReader(),
      body: async f => ({
        restaurantId: r, tableId: "00000000-0000-0000-0000-000000000000",
        orderIds: [f.billOrder],
      }),
      // Scoped by restaurant, table AND admission: a foreign table is refused
      // before either its food or its payment readiness can be read.
      expect: [403], expectError: /teléfono|phone/i },

    // ── promotions: the rest of their life ───────────────────────────────
    { name: "PATCH /api/promotions (switch off)", as: "manager", method: "PATCH", path: "/api/promotions",
      body: async f => ({ id: await promoId(f), active: false }), expect: [200] },
    { name: "DELETE /api/promotions", as: "manager", method: "DELETE", path: "/api/promotions",
      body: async f => ({ id: await promoId(f) }), expect: [200] },

    // ── the team ─────────────────────────────────────────────────────────
    // Inviting sends mail through Supabase's own service, which without SMTP
    // configured refuses valid addresses or caps at a few per hour. Today an owner
    // CANNOT add their team: the demo team exists because the seed creates it
    // directly, not by invitation.
    { name: "POST /api/staff (invite)", as: "owner", method: "POST", path: "/api/staff",
      body: { email: `${MARK}@tabletap.dev`, role: "waiter" }, expect: [200],
      known: "Supabase has no SMTP: inviting by email does not work" },
    // These two decide who may do what, and neither had ever run: both looked
    // the member up by the email the INVITE case uses, inviting needs SMTP
    // development does not have, so the id was always empty and both routes
    // refused on the missing field. `expect: [200, 400, 404]` took it.
    //
    // The fixture now puts a real member on the payroll for them to act on.
    { name: "PATCH /api/staff (change role)", as: "owner", method: "PATCH", path: "/api/staff",
      body: async f => ({ id: f.crewId, role: "cashier" }), expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("staff").select("role").eq("id", f.crewId).maybeSingle();
        return data?.role === "cashier" ? true : `answered 200 and the role is still "${data?.role}"`;
      } },
    // A bad role and a missing id share one message, so the text cannot tell
    // them apart — what does is that the member is real, which leaves the role
    // as the only thing here to refuse.
    { name: "PATCH /api/staff (a role that does not exist)", as: "owner", method: "PATCH",
      path: "/api/staff", body: async f => ({ id: f.crewId, role: "emperor" }),
      expect: [400] },
    { name: "PATCH /api/staff (manager cannot promote)", as: "manager", method: "PATCH",
      path: "/api/staff", body: async f => ({ id: f.crewId, role: "owner" }),
      // 403 and nothing else. "owner" is a real role and the member is real,
      // so the only thing left to refuse on is who is asking — a manager who
      // can mint an owner is a manager who owns the restaurant. Accepting 400
      // here would also accept the state this case spent its life in, where
      // there was no member and the id was empty.
      expect: [403],
      check: () => "a manager changed a role and was told 200" },
    { name: "DELETE /api/staff", as: "owner", method: "DELETE", path: "/api/staff",
      body: async f => ({ id: f.crewId }), expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("staff").select("id").eq("id", f.crewId).maybeSingle();
        return data ? "answered 200 and the member is still on the payroll" : true;
      } },

    // ── the webhooks: no signature, no entry ─────────────────────────────
    //
    // There are two, because there are two Stripe accounts: our own carries
    // the subscriptions, and each restaurant's carries the food a diner pays
    // for as a direct charge. Each endpoint verifies against its own secret.
    { name: "POST /api/webhooks/stripe (no signature)", as: "diner", method: "POST",
      path: "/api/webhooks/stripe", body: { type: "customer.subscription.updated" },
      // Accepting this would let anyone put a restaurant on any plan.
      expect: [400, 401, 403] },
    { name: "POST /api/webhooks/stripe/connect (no signature)", as: "diner", method: "POST",
      path: "/api/webhooks/stripe/connect", body: { type: "checkout.session.completed" },
      // Accepting this would let anyone mark orders as paid.
      expect: [400, 401, 403] },

    // ── owner: money and team ────────────────────────────────────────────
    { name: "POST /api/billing/portal", as: "owner", method: "POST", path: "/api/billing/portal",
      body: {}, expect: [200, 400, 409] },
    // 502 while Stripe Connect is not configured on the platform account: the
    // route reports the upstream failure instead of swallowing it, which is
    // correct. Once Connect exists, this will be a 200.
    // "Conectar Stripe" once accepted 502 as healthy, and so passed every run
    // while Stripe refused every account it was asked to make: no restaurant
    // could connect at all. Dev is on Stripe's test mode, so this makes a real
    // test account, demands the onboarding link, and closes the account again.
    { name: "POST /api/connect/onboard", as: "owner", method: "POST", path: "/api/connect/onboard",
      arrange: async f => {
        const { data: was } = await f.admin.from("restaurants")
          .select("stripe_account_id, stripe_charges_enabled").eq("id", r).single();
        await f.admin.from("restaurants").update({ stripe_account_id: null, stripe_charges_enabled: false }).eq("id", r);
        return async () => {
          const { data: now } = await f.admin.from("restaurants").select("stripe_account_id").eq("id", r).single();
          if (now?.stripe_account_id && now.stripe_account_id !== was?.stripe_account_id) {
            const { default: Stripe } = await import("stripe");
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            await stripe.rawRequest("POST", `/v2/core/accounts/${now.stripe_account_id}/close`,
              { applied_configurations: ["merchant"] }, { apiVersion: "2026-06-24.preview" }).catch(() => {});
          }
          await f.admin.from("restaurants").update({
            stripe_account_id: was?.stripe_account_id ?? null,
            stripe_charges_enabled: was?.stripe_charges_enabled ?? false,
          }).eq("id", r);
        };
      },
      body: {}, expect: [200],
      check: async (d, f) => {
        if (!/^https:\/\/connect\.stripe\.com\//.test(d.url ?? "")) return `no Stripe onboarding link (${JSON.stringify(d).slice(0, 80)})`;
        const { data } = await f.admin.from("restaurants").select("stripe_account_id").eq("id", r).single();
        return /^acct_/.test(data?.stripe_account_id ?? "") || "no Stripe account was stored for the restaurant";
      } },
    { name: "POST /api/billing/checkout", as: "owner", method: "POST", path: "/api/billing/checkout",
      body: { plan: "servicio" }, expect: [200, 400, 409, 502] },

    // ── the routes that destroy things: checked by their refusal ─────────
    //
    // These delete restaurants, delete logins and cancel subscriptions. A case
    // that exercised them for real would be a case that wrecks the demo
    // restaurant, and `pnpm api:prod` would do it to production. What matters
    // and what is safe to assert is the same thing: who is turned away.
    { name: "POST /api/billing/cancel (waiter refused)", as: "waiter", method: "POST",
      path: "/api/billing/cancel", body: {}, expect: [401, 403] },
    { name: "POST /api/admin/users (manager refused)", as: "manager", method: "POST",
      path: "/api/admin/users",
      body: { email: "nobody@tabletap.dev", password: "not-a-real-one", role: "admin" },
      expect: [401, 403] },
    // A platform admin moves a restaurant to another plan, and its team with
    // it. Put back afterwards, trial and all.
    { name: "PATCH /api/admin/restaurants (move a plan)", as: "platformAdmin", method: "PATCH",
      path: "/api/admin/restaurants",
      arrange: async f => {
        const { data: was } = await f.admin.from("restaurants")
          .select("plan, plan_status, trial_ends_at, plan_ends_at").eq("id", r).single();
        const { data: tiers } = await f.admin.from("plan_limits").select("plan").order("rank");
        f.planBefore = was;
        f.planTarget = (tiers ?? []).map(t => t.plan).find(p => p !== was?.plan);
        return async () => {
          await f.admin.from("restaurants").update(was).eq("id", r);
          await f.admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "settings").like("detail", "plan=%by=platform_admin");
        };
      },
      body: f => ({ id: r, plan: f.planTarget }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("restaurants").select("plan, plan_status").eq("id", r).single();
        return data?.plan === d.to && data?.plan_status === "active" || `the restaurant is on ${data?.plan}/${data?.plan_status}, not ${d.to}`;
      } },
    // An owner cannot give themselves a plan — only the platform admin moves one.
    { name: "PATCH /api/admin/restaurants (an owner refused)", as: "owner", method: "PATCH",
      path: "/api/admin/restaurants",
      arrange: async f => {
        const { data } = await f.admin.from("restaurants").select("plan").eq("id", r).single();
        f.ownerPlanBefore = data?.plan;
        return async () => {};
      },
      body: { id: r, plan: "grupo" }, expect: [403],
      effect: async f => {
        const { data } = await f.admin.from("restaurants").select("plan").eq("id", r).single();
        return data?.plan === f.ownerPlanBefore || `the owner moved their own plan to ${data?.plan}`;
      } },
    { name: "DELETE /api/admin/restaurants (manager refused)", as: "manager", method: "DELETE",
      path: "/api/admin/restaurants", body: async f => ({ id: f.restaurant.id }),
      expect: [401, 403] },
    { name: "POST /api/signup (rejects an empty form)", as: "diner", method: "POST",
      path: "/api/signup", body: {}, expect: [400, 429] },
    // The front door, which nothing had ever opened. The only case here
    // refused an empty form — and accepted a rate-limit answer as a pass, so
    // it could be satisfied without the route validating anything.
    //
    // This one signs a restaurant up for real and then takes it away again:
    // `arrange` hands back the undo, which removes the restaurant and the
    // login whatever the case does. A 429 is reported as a skipped line rather
    // than a pass, because five attempts a minute is a real ceiling and three
    // runs back to back will find it.
    { name: "POST /api/signup (a restaurant opens an account)", as: "diner",
      method: "POST", path: "/api/signup",
      arrange: async f => {
        f.signupEmail = `${MARK}-signup-${Date.now()}@tabletap.dev`;
        f.signupName = `${MARK} signup ${Date.now()}`;
        return async () => {
          await f.admin.from("restaurants").delete().eq("name", f.signupName);
          const user = await loginByEmail(f.admin, f.signupEmail);
          if (user) await f.admin.auth.admin.deleteUser(user.id).catch(() => {});
        };
      },
      body: async f => ({
        restaurantName: f.signupName, email: f.signupEmail,
        password: "longenough1", acceptedTerms: true,
      }),
      expect: [200],
      known: "five signups a minute is the ceiling; this run spent it",
      effect: async (f, status) => {
        if (status !== 200) return true;
        const { data: r } = await f.admin
          .from("restaurants").select("*").eq("name", f.signupName).maybeSingle();
        if (!r) return "answered ok and created no restaurant";
        // A month of everything, no card — and the terms they agreed to, which
        // is only worth something if we can say which document it was.
        if (r.plan_status !== "trialing") return `the trial opened as "${r.plan_status}"`;
        if (!r.trial_ends_at) return "the trial has no end";
        if (!r.terms_version || r.terms_accepted_email !== f.signupEmail) {
          return "the terms they accepted were not written down against them";
        }
        // And the owner is the person who signed up: `getMembership` reads
        // `restaurants.owner_id` before it looks at the staff table, which is
        // why a founding owner needs no staff row.
        const user = await loginByEmail(f.admin, f.signupEmail);
        if (!user) return "answered ok and created no login";
        if (r.owner_id !== user.id) return "the restaurant belongs to somebody else";
        return true;
      } },
  ];
}
