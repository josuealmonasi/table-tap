import { randomUUID } from "node:crypto";

export function loyaltyCases(fx) {
  const { restaurant, paidOrder } = fx;
  const r = restaurant.id;
  return [
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
      path: "/api/loyalty/redeem", body: { code: fx.stampableCode ?? "", step: fx.stampableStep, round: fx.stampableRound, requestKey: randomUUID() },
      expect: [409], expectError: /faltan visitas|hasn't reached/i },
    // The reward the waiter pressed is named, so the same tap twice spends it
    // once — on a ladder, a second tap would otherwise spend the NEXT reward.
    { name: "POST /api/loyalty/redeem (a ready card)", as: "cashier", method: "POST",
      path: "/api/loyalty/redeem", body: { code: fx.readyCode ?? "no-ready-card-in-the-seed", step: fx.readyStep, round: fx.readyRound, requestKey: randomUUID() }, expect: [200],
      check: d => {
        if (typeof d.spent !== "string" || d.standing?.ready !== false) return `answered ${JSON.stringify(d)}`;
        const step = (d.standing.steps ?? []).find(s => s.visits === fx.readyStep);
        return !step || step.done || d.standing.goal === fx.readyStep || "the reward spent is not marked redeemed";
      } },
    { name: "POST /api/loyalty/redeem (the same reward twice)", as: "waiter", method: "POST",
      path: "/api/loyalty/redeem", body: { code: fx.readyCode ?? "", step: fx.readyStep, round: fx.readyRound, requestKey: randomUUID() },
      expect: [409], expectError: /ya se canjeó|already redeemed|otra ronda|another round/i },
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
      body: { code: "PAVSEDXTEST0", step: 2, round: 0, requestKey: randomUUID() }, expect: [200],
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
  ];
}
