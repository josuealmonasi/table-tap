import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPromotions } from "@/lib/promotions-data";

/**
 * A failed read of the promotions is not "no promotions".
 *
 * Checkout, the waiter's order and the till all price a cart against this
 * list. Read as empty, a blip charged a diner full price for the two-for-one
 * the menu had just shown them — and the dashboard told a manager there were
 * no deals, so they would set them up again.
 */

type Answer = { data: unknown; error: { message: string } | null };

function client(answers: Record<string, Answer>): SupabaseClient {
  return {
    from: (table: string) => {
      const answer = answers[table];
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        then: (resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(answer).then(resolve, reject),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const PROMO = { id: "p1", kind: "combo", name: "Combo", active: true, sort_order: 0 };
const down = { data: null, error: { message: "canceling statement due to statement timeout" } };

describe("fetchPromotions", () => {
  it("is an empty list when the restaurant has none", async () => {
    await expect(fetchPromotions(client({ promotions: { data: [], error: null } }), "r1")).resolves.toEqual([]);
  });

  it("returns each promotion with what it includes", async () => {
    const promos = await fetchPromotions(
      client({
        promotions: { data: [PROMO], error: null },
        promotion_items: { data: [{ promotion_id: "p1", item_id: "i1", qty: 2 }], error: null },
      }),
      "r1",
    );
    expect(promos).toHaveLength(1);
    expect(JSON.stringify(promos[0])).toContain("i1");
  });

  it("throws when the promotions cannot be read", async () => {
    await expect(fetchPromotions(client({ promotions: down }), "r1")).rejects.toThrow("Could not load the promotions");
  });

  it("throws when what they include cannot be read, rather than pricing a combo with nothing in it", async () => {
    await expect(
      fetchPromotions(client({ promotions: { data: [PROMO], error: null }, promotion_items: down }), "r1"),
    ).rejects.toThrow("Could not load what the promotions include");
  });
});
