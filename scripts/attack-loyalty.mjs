// ============================================================================
// What a signed-in person can do to a visit card that they should not.
//
// Judged by effect, like the rest of `pnpm attack`: the visits and rewards are
// counted with the secret key before and after, because a route that answers
// 200 and a route that stamped are not the same claim.
//
//   - another restaurant's card, scanned at ours: no visit, anywhere
//   - the kitchen: no visit
//   - the same card twice in the same instant: one visit, not two
//   - a ready reward spent by two people at once: spent once
//   - on a ladder with every reward ready, the same button pressed twice at
//     once: one reward, not the next one too; a later reward, out of order:
//     nothing
//
// Everything planted here is removed again, whatever happens in between.
// ============================================================================

import { randomUUID } from "node:crypto";

const CARD = "ATKXTEST0000"; // valid, and nobody could be handed it
const NEIGHBOUR_CARD = "ATKXTEST0001";
const LADDER_CARD = "ATKXTEST0002";

/** One visit per card per day, however many ask; one reward, however many spend it. */
export async function attackLoyalty({ admin, post, who, home, ok, bad }) {
  const count = async (table, cardId) =>
    (await admin.from(table).select("id", { count: "exact", head: true }).eq("card_id", cardId)).count ?? 0;

  // Leftovers from a run that did not finish, before planting more.
  await admin.from("loyalty_cards").delete().in("code", [CARD, NEIGHBOUR_CARD, LADDER_CARD]);
  await admin.from("loyalty_programs").delete().eq("reward", "attack");

  const { data: program } = await admin
    .from("loyalty_programs").select("active, goal").eq("restaurant_id", home.id).maybeSingle();
  if (!program?.active) {
    bad("the demo's visit card program is not on — the loyalty attacks cannot run");
    return;
  }

  // A neighbour whose own cards CAN be stamped: on a plan with loyalty and a
  // program switched on. Without that, "their card gains no visit" passes for
  // the wrong reason — their program was off — and would pass just the same
  // if our route stamped cards by their code alone, in whichever restaurant.
  const { data: capable } = await admin
    .from("restaurants").select("id, plan_limits!inner(allows_loyalty)")
    .neq("id", home.id).eq("plan_limits.allows_loyalty", true).limit(1).maybeSingle();
  if (!capable) {
    bad("no other restaurant is on a plan with loyalty — the cross-tenant case cannot run");
    return;
  }
  const neighbour = { id: capable.id };
  const { data: theirProgram } = await admin
    .from("loyalty_programs").select("id, active").eq("restaurant_id", neighbour.id).maybeSingle();
  const madeProgram = !theirProgram;
  if (madeProgram) {
    await admin.from("loyalty_programs").insert({ restaurant_id: neighbour.id, active: true, goal: 2, reward: "attack" });
  } else if (!theirProgram.active) {
    await admin.from("loyalty_programs").update({ active: true }).eq("id", theirProgram.id);
  }

  const planted = [];
  try {
    const { data: ours } = await admin
      .from("loyalty_cards").insert({ restaurant_id: home.id, code: CARD, goal: 2, steps: [{ visits: 2, reward: "MX$50" }] })
      .select("id").single();
    const { data: theirs } = await admin
      .from("loyalty_cards").insert({ restaurant_id: neighbour.id, code: NEIGHBOUR_CARD, goal: 2 })
      .select("id").single();
    planted.push(ours.id, theirs.id);

    // Their card, at our till.
    await post("/api/loyalty/stamp", { code: NEIGHBOUR_CARD }, who.waiter);
    const theirVisits = await count("loyalty_visits", theirs.id);
    if (theirVisits === 0) ok("another restaurant's card, scanned here, gains no visit");
    else bad(`another restaurant's card gained ${theirVisits} visit(s) from our waiter`);

    // The pass.
    await post("/api/loyalty/stamp", { code: CARD }, who.kitchen);
    if ((await count("loyalty_visits", ours.id)) === 0) ok("the kitchen cannot stamp a card");
    else bad("the kitchen stamped a visit card");

    // Two waiters, one card, the same instant.
    await Promise.all([
      post("/api/loyalty/stamp", { code: CARD }, who.waiter),
      post("/api/loyalty/stamp", { code: CARD }, who.waiter),
      post("/api/loyalty/stamp", { code: CARD }, who.waiter),
    ]);
    const visits = await count("loyalty_visits", ours.id);
    if (visits === 1) ok("three scans of one card at once record one visit");
    else bad(`three scans at once recorded ${visits} visits`);

    // Ready it with a past day, then two people spend it at once.
    // Bank enough visits for the NEXT round too: otherwise a second redemption
    // is refused for insufficient visits and the missing round check hides.
    const seeded = await admin.from("loyalty_visits").insert(Array.from({ length: 1 + program.goal }, (_, i) => ({
      card_id: ours.id, restaurant_id: home.id,
      visit_day: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), actor_email: "attack@tabletap.dev",
    })));
    if (seeded.error) throw seeded.error;
    const handover = { code: CARD, step: 2, round: 0, requestKey: randomUUID() };
    await Promise.all([
      post("/api/loyalty/redeem", handover, who.waiter),
      post("/api/loyalty/redeem", handover, who.waiter),
    ]);
    const spent = await count("loyalty_redemptions", ours.id);
    if (spent === 1) ok("a ready reward spent twice at once is spent once");
    else bad(`a ready reward was spent ${spent} times`);

    const { data: receipts, error: receiptError } = await admin.from("loyalty_redemptions")
      .select("visits_used, reward").eq("card_id", ours.id);
    const { data: after, error: cardError } = await admin.from("loyalty_cards").select("round_no").eq("id", ours.id).single();
    if (!receiptError && !cardError && receipts?.length === 1 && receipts[0].visits_used === 2 &&
        receipts[0].reward === "MX$50" && after?.round_no === 1) ok("S15 concurrent retry uses one MX$50 reward and closes one round");
    else bad(`S15 concurrent retry changed the wrong reward or round: ${JSON.stringify({ receipts, after, receiptError, cardError })}`);
    // Another device can have its own key for the same displayed handover.
    // A retry and a fresh key on that old round must both leave the ledger alone.
    await Promise.all([
      post("/api/loyalty/redeem", handover, who.waiter),
      post("/api/loyalty/redeem", { ...handover, requestKey: randomUUID() }, who.waiter),
    ]);
    if (await count("loyalty_redemptions", ours.id) === 1) ok("S15 replay and stale round cannot spend the next reward");
    else bad("S15 a replay or stale screen spent the next round's reward");

    // A ladder with both rewards ready. The button names the reward it spends,
    // so two taps on "coffee" spend the coffee once — without that, the second
    // tap would find the dessert next and spend it too.
    const { data: ladder } = await admin
      .from("loyalty_cards")
      .insert({
        restaurant_id: home.id, code: LADDER_CARD, goal: 3,
        steps: [{ visits: 2, reward: "attack coffee" }, { visits: 3, reward: "attack dessert" }],
      })
      .select("id").single();
    planted.push(ladder.id);
    await admin.from("loyalty_visits").insert(["2026-01-01", "2026-01-02", "2026-01-03"].map(visit_day => ({
      card_id: ladder.id, restaurant_id: home.id, visit_day, actor_email: "attack@tabletap.dev",
    })));
    await post("/api/loyalty/redeem", { code: LADDER_CARD, step: 3, round: 0, requestKey: randomUUID() }, who.waiter);
    const outOfOrder = await count("loyalty_redemptions", ladder.id);
    if (outOfOrder === 0) ok("a later reward pressed before the one due is not spent");
    else bad(`a later reward was spent out of order (${outOfOrder} redemption(s))`);
    await Promise.all([
      post("/api/loyalty/redeem", { code: LADDER_CARD, step: 2, round: 0, requestKey: randomUUID() }, who.waiter),
      post("/api/loyalty/redeem", { code: LADDER_CARD, step: 2, round: 0, requestKey: randomUUID() }, who.waiter),
    ]);
    const onLadder = await count("loyalty_redemptions", ladder.id);
    if (onLadder === 1) ok("one reward on a ladder, pressed twice at once, spends that reward once and not the next");
    else bad(`one press twice on a ladder spent ${onLadder} rewards`);
  } finally {
    if (madeProgram) await admin.from("loyalty_programs").delete().eq("restaurant_id", neighbour.id);
    else if (!theirProgram.active) await admin.from("loyalty_programs").update({ active: false }).eq("id", theirProgram.id);
    if (planted.length) {
      // The lines those stamps wrote, so the log is as it was.
      await admin.from("user_logs").delete()
        .eq("restaurant_id", home.id).eq("entity", "loyalty").like("detail", `card=${CARD.slice(0, 4)}%`);
      await admin.from("loyalty_cards").delete().in("id", planted);
    }
  }
}
