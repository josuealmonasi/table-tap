import { expect, it } from "vitest";
import { legacyTerminalTimes } from "../../../scripts/mock-terminal-times.mjs";
import { DRAWER_ERA } from "../../../scripts/money-drawer-values.mjs";

it.each([
  "2026-10-20T12:00:00Z", "2026-10-23T18:21:00Z", "2026-10-23T19:32:00Z", "2030-01-01T00:00:00Z",
])("keeps unsigned demo history before signed manifests when seeded at %s", at => {
  const { saleAt, depositAt } = legacyTerminalTimes(Date.parse(at));
  expect(Date.parse(depositAt)).toBeLessThan(Date.parse(DRAWER_ERA));
  expect(Date.parse(saleAt)).toBeLessThan(Date.parse(depositAt));
  expect(Date.parse(depositAt) - Date.parse(saleAt)).toBe(30 * 3600000);
  expect(Date.parse(depositAt)).toBeLessThan(Date.parse(at));
});

it("retains the original recent dates while they still represent legacy history", () => {
  expect(legacyTerminalTimes(Date.parse("2026-10-23T18:21:00Z"))).toEqual({
    saleAt: "2026-10-20T18:21:00.000Z", depositAt: "2026-10-22T00:21:00.000Z",
  });
});

it("stops the legacy example drifting forward through the evidence cutoff", () => {
  expect(legacyTerminalTimes(Date.parse("2026-10-23T19:32:00Z")))
    .toEqual(legacyTerminalTimes(Date.parse("2030-01-01T00:00:00Z")));
});
