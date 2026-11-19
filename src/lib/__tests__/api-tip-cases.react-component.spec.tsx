import { expect, it } from "vitest";
import { tipBaseCase } from "../../../scripts/api-cases/tip-base.mjs";
import * as gate from "../../../scripts/api-tip-helper.mjs";
import { ordersTipBase, splitTipBase, tipFromPercent } from "@/lib/tip-base";

it("the API gate loads the app's actual pure helper, including its rounding and food allocation", () => {
  const orders = [{ total: 120.01, service_fee: 10, tip: 10, collected: 20, collected_tip: 5 }];
  expect(gate.ordersTipBase(orders)).toBe(ordersTipBase(orders));
  for (const pct of [0, 10, 15, 100]) {
    const base = splitTipBase(ordersTipBase(orders), 3, [0, 2]);
    expect(gate.tipFromPercent(gate.splitTipBase(gate.ordersTipBase(orders), 3, [0, 2]), pct)).toBe(tipFromPercent(base, pct));
  }
});

it.each(["bill", "split", "slots", "account"] as const)("the %s API assertion fails on a planted wrong tip", async kind => {
  let actual = 10;
  const admin = { from: () => {
    const query = { select: () => query, eq: () => query, contains: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ tip: actual,
        stripe_params: { metadata: { settle_tip: String(actual) } }, stripe_session_id: null }], error: null }).then(resolve) };
    return query;
  } };
  const fixture = { admin, tipBaseCase: { tip: 10, accountId: "account", fixture: { orderId: "o" } } };
  const effect = tipBaseCase(kind).effect;
  expect(await effect(fixture)).toBe(true);
  actual = 12; // The old 10% of the whole 120-peso bill, service and earlier tip included.
  expect(await effect(fixture)).not.toBe(true);
});
