import { expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string) => k }));
const { over } = await import("../TrackerOverlay");
const order = (status: string, paid: boolean, written_off = false) => ({ status, paid, written_off }) as never;

it("keeps following a delivered order until it is paid, so the rating can follow (A8)", () => {
  expect(over(order("completed", false))).toBe(false);
  expect(over(order("completed", true))).toBe(true);
  expect(over(order("cancelled", false))).toBe(true);
  expect(over(order("preparing", false, true))).toBe(true);
  expect(over(order("ready", true))).toBe(false);
});
