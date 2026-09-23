// ============================================================================
// Loyalty in the demo: a program switched on, and a card at every stage.
//
// One just started, one halfway, one with its reward waiting, and one already
// on its second round after spending a reward — so the scanner, the rewards
// page and the owner's numbers all have something true to show the first time
// anybody opens them, and the gates have a card of each kind to reach for.
//
// Visits are on real past days and stamped by the people who work the floor,
// the way the scanner writes them: one per card per day, never by the kitchen.
// ============================================================================
import { randomBytes } from "node:crypto";
import { bulkInsert } from "./menu-catalog.mjs";

// The same alphabet as src/lib/loyalty/code.ts; loyalty_cards.code refuses
// anything else, so a slip here fails the seed rather than hiding.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code = () => Array.from(randomBytes(12), b => ALPHABET[b & 31]).join("");

const GOAL = 8;
const REWARD = "Free dessert";
const FLOOR = ["demo-waiter@tabletap.dev", "demo-cashier@tabletap.dev", "demo-manager@tabletap.dev"];

/** Visits on `count` distinct past days, the most recent `endDaysAgo` ago. */
function visitDays(count, endDaysAgo) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.now() - (endDaysAgo + i * 4) * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

export async function seedLoyalty(pg, rid) {
  await bulkInsert(
    pg,
    "loyalty_programs",
    ["restaurant_id", "active", "goal", "reward"],
    [[rid, true, GOAL, REWARD]],
  );

  // visits: how many the card has; redeemed: rewards it has already spent.
  const stages = [
    { visits: 1, redeemed: 0, endDaysAgo: 2 },
    { visits: 4, redeemed: 0, endDaysAgo: 1 },
    { visits: GOAL, redeemed: 0, endDaysAgo: 3 },
    { visits: GOAL + 3, redeemed: 1, endDaysAgo: 1 },
  ];

  for (const stage of stages) {
    const days = visitDays(stage.visits, stage.endDaysAgo);
    const oldest = days[days.length - 1];
    const [card] = await bulkInsert(
      pg,
      "loyalty_cards",
      ["restaurant_id", "code", "goal", "created_at"],
      [[rid, code(), GOAL, `${oldest}T19:00:00Z`]],
      "id",
    );
    await bulkInsert(
      pg,
      "loyalty_visits",
      ["card_id", "restaurant_id", "visit_day", "actor_email", "created_at"],
      days.map((day, i) => [card.id, rid, day, FLOOR[i % FLOOR.length], `${day}T20:00:00Z`]),
    );
    if (stage.redeemed > 0) {
      // Spent on the visit that reached the goal, by whoever was at the till.
      const spentOn = days[days.length - GOAL];
      await bulkInsert(
        pg,
        "loyalty_redemptions",
        ["card_id", "restaurant_id", "visits_used", "reward", "actor_email", "created_at"],
        [[card.id, rid, GOAL, REWARD, FLOOR[1], `${spentOn}T21:00:00Z`]],
      );
    }
  }
}
