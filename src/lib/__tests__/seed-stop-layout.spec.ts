import { expect, it, vi } from "vitest";
import { PUBLIC } from "../../../scripts/layout-paths.mjs";
import { SEED_STOP_TOKEN } from "../../../scripts/seed-stop-token.mjs";
import { TERMS_VERSION } from "../../../scripts/terms-version.mjs";

const inserts = vi.hoisted(() => vi.fn(async (_pg, table, _columns, _rows) => {
  void _columns; void _rows;
  if (table === "loyalty_cards") return [{ id: "card" }];
  return [];
}));
vi.mock("../../../scripts/menu-catalog.mjs", () => ({ bulkInsert: inserts }));
import { seedLoyalty } from "../../../scripts/mock-loyalty.mjs";

it("measures the seeded ticket stop link as well as the invalid link", () => {
  expect(PUBLIC).toContain("/tickets/stop");
  expect(PUBLIC).toContain(`/tickets/stop?t=${SEED_STOP_TOKEN}`);
});

it("seeds one consented card with the layout link", async () => {
  inserts.mockClear();
  await seedLoyalty({}, "restaurant");
  const cards = inserts.mock.calls.filter(([, table]) => table === "loyalty_cards")
    .map(([, , columns, rows]) => Object.fromEntries(columns.map((column: string, i: number) => [column, rows[0][i]])));
  const linked = cards.filter(card => card.email);
  expect(linked).toHaveLength(1);
  expect(linked[0]).toMatchObject({
    email: "stop-link@example.invalid", email_notice_version: TERMS_VERSION,
    email_set_by: "seed", email_unsubscribe: SEED_STOP_TOKEN,
  });
  expect(Date.parse(linked[0].email_consent_at)).not.toBeNaN();
});
