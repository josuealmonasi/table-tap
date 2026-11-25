import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const member = vi.hoisted(() => vi.fn());
vi.mock("@/lib/table-membership", () => ({ tableMember: member }));
import { memberRatingOrders } from "@/lib/rating-membership";

const req = () => new NextRequest("http://localhost/api/ratings");
beforeEach(() => { member.mockReset().mockResolvedValue({ id: "phone" }); });

it("keeps a counter order's link as its own credential", async () => {
  const counter = { id: "c", table_id: null, table_label: null, session_id: null, diner: null };
  expect(await memberRatingOrders(req(), "r", [counter])).toEqual([counter]);
  expect(member).not.toHaveBeenCalled();
});

it("rates a table order only for the phone that placed it", async () => {
  const mine = { id: "a", table_id: "t", table_label: "Mesa 4", session_id: "s", diner: "phone" };
  const theirs = { ...mine, id: "b", diner: "other" };
  expect(await memberRatingOrders(req(), "r", [mine, theirs])).toEqual([mine]);
});

// Codex bl40 #8: deleting the table nulls table_id and, with the sittings,
// session_id. The retained label must keep it off the bearer path.
it("refuses a deleted table's order instead of treating it as a counter order", async () => {
  const orphan = { id: "o", table_id: null, table_label: "Mesa 4", session_id: null, diner: "phone" };
  expect(await memberRatingOrders(req(), "r", [orphan])).toEqual([]);
  expect(member).not.toHaveBeenCalled();
});
