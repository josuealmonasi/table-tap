// ============================================================================
// Loyalty in the demo: a program switched on, and a card at every stage.
//
// The program is a reward ladder — a coffee at 4 visits, a dessert at 8, a
// main at 12 — and there is a card at every stage of it: one just started, one
// that spent its coffee and has its dessert waiting, one at 12 that skipped
// its coffee and has all three waiting, and one on its second round after
// spending the whole ladder. So the scanner, the rewards page and the owner's
// numbers all have something true to show the first time anybody opens them,
// and the gates have a card of each kind to reach for.
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

const LADDER = [
  { visits: 4, reward: "Free coffee" },
  { visits: 8, reward: "Free dessert" },
  { visits: 12, reward: "Free main course" },
];
const GOAL = LADDER[LADDER.length - 1].visits;
const REWARD = LADDER[LADDER.length - 1].reward;
const FLOOR = ["demo-waiter@tabletap.dev", "demo-cashier@tabletap.dev", "demo-manager@tabletap.dev"];

// The demo restaurant's own calendar, the one a stamp is dated by. The first
// version dated visits in UTC: after six in the evening in Mexico City, "one
// day ago" in UTC is today there, so the seed quietly filled today's slot and
// the card's first real scan said "already has today's visit".
const ZONE = "America/Mexico_City";
const localDay = when => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(when);

/** Visits on `count` distinct past days, the most recent `endDaysAgo` ago, never today. */
function visitDays(count, endDaysAgo) {
  return Array.from({ length: count }, (_, i) => {
    const days = Math.max(1, endDaysAgo) + i * 4;
    return localDay(new Date(Date.now() - days * 86_400_000));
  });
}

export async function seedLoyalty(pg, rid) {
  const steps = JSON.stringify(LADDER);
  await bulkInsert(
    pg,
    "loyalty_programs",
    ["restaurant_id", "active", "goal", "reward", "steps"],
    [[rid, true, GOAL, REWARD, steps]],
  );

  // visits: how many the card has. spent: the rewards redeemed, by the visits
  // of their step, each on the visit that reached it; the last step closes a
  // round, so everything after it is the next round's.
  const stages = [
    { visits: 1, spent: [], endDaysAgo: 2 },
    { visits: 8, spent: [4], endDaysAgo: 1 },
    { visits: 12, spent: [], endDaysAgo: 3 },
    { visits: GOAL + 3, spent: [4, 8, 12], endDaysAgo: 1 },
  ];

  for (const stage of stages) {
    const days = visitDays(stage.visits, stage.endDaysAgo);
    const oldest = days[days.length - 1];
    const rounds = stage.spent.filter(step => step === GOAL).length;
    const [card] = await bulkInsert(
      pg,
      "loyalty_cards",
      ["restaurant_id", "code", "goal", "steps", "round_no", "created_at"],
      [[rid, code(), GOAL, steps, rounds, `${oldest}T19:00:00Z`]],
      "id",
    );
    await bulkInsert(
      pg,
      "loyalty_visits",
      ["card_id", "restaurant_id", "visit_day", "actor_email", "created_at"],
      days.map((day, i) => [card.id, rid, day, FLOOR[i % FLOOR.length], `${day}T20:00:00Z`]),
    );
    if (stage.spent.length > 0) {
      // Each spent on the visit that reached it, by whoever was at the till.
      // `days` runs newest first, so the visit that made N is days[len - N].
      let round = 0;
      const rows = stage.spent.map(step => {
        const row = [
          card.id, rid, step === GOAL ? GOAL : 0, LADDER.find(s => s.visits === step).reward,
          FLOOR[1], `${days[days.length - step]}T21:00:00Z`, step, round,
        ];
        if (step === GOAL) round++;
        return row;
      });
      await bulkInsert(
        pg,
        "loyalty_redemptions",
        ["card_id", "restaurant_id", "visits_used", "reward", "actor_email", "created_at", "step", "round_no"],
        rows,
      );
    }
  }
}
