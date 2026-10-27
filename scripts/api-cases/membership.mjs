import { tableJoinScenario } from "../table-join-scenario.mjs";
import { checkTableJoin } from "../check-table-join.mjs";

export function membershipCases(fx) {
  const { restaurant } = fx;
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
  ];
}
