import { expect, it, vi } from "vitest";
import { probeDialogs, typingFaults } from "../../../scripts/dialog-probe.mjs";
import { phaseTimings } from "../../../scripts/browser-jobs.mjs";

it("propagates failed dialog-visit navigation instead of continuing to another page", async () => {
  const tab = { on: vi.fn(), goto: vi.fn().mockRejectedValue(new Error("cannot navigate")) };
  await expect(probeDialogs({ tab, log: vi.fn(), phase: phaseTimings().phase, stop: vi.fn() },
    { url: "http://localhost/dashboard/orders", role: "owner", path: "/dashboard/orders" }))
    .rejects.toThrow("cannot navigate");
  expect(tab.goto).toHaveBeenCalledTimes(1);
});

it("propagates a broken page typing check instead of returning no faults", async () => {
  const tab = { locator: () => ({ last: () => ({ locator: () => ({ count: async () => { throw new Error("typing check broke"); } }) }) }) };
  await expect(typingFaults(tab, "main, body", 8)).rejects.toThrow("typing check broke");
});

it("reports a visible field that could not be typed into", async () => {
  const field = { isVisible: async () => true, evaluate: async () => "amount", getAttribute: async () => "text",
    click: async () => { throw new Error("click timed out"); } };
  const tab = { locator: () => ({ last: () => ({ locator: () => ({ count: async () => 1, nth: () => field }) }) }) };
  expect(await typingFaults(tab)).toEqual(["could not type in «amount»: click timed out"]);
});

it("comes back to its page when a click navigated away, before the next label", async () => {
  // «Main Menu Abrir →» on /dashboard left for the menu editor, and the menus'
  // rename, copy and delete dialogs were looked for there and never checked.
  const { samePage } = await import("../../../scripts/dialog-probe.mjs");
  expect(samePage("http://localhost/dashboard", "http://localhost/dashboard")).toBe(true);
  expect(samePage("http://localhost/dashboard/main-menu", "http://localhost/dashboard")).toBe(false);
  expect(samePage("http://localhost/dashboard?tab=a", "http://localhost/dashboard")).toBe(false);
  const source = (await import("node:fs")).readFileSync("scripts/dialog-probe.mjs", "utf8");
  const loop = source.slice(source.indexOf("for (const label of"));
  expect(loop.indexOf("if (!samePage(tab.url(), url)) await navigate(")).toBeGreaterThan(-1);
  expect(loop.indexOf("if (!samePage(tab.url(), url))")).toBeLessThan(loop.indexOf("clickByLabel(tab, label)"));
});

it("answers the discard question a dirty form asks, and leaves other dialogs alone", async () => {
  // The probe types into a form, so Escape now asks before closing. Unanswered,
  // the visit waited on a dialog that was waiting on it (cross-review of S23, 7).
  const { answerDiscard } = await import("../../../scripts/dialog-probe.mjs");
  const click = vi.fn();
  const tab = (shown: boolean) => ({
    getByRole: () => ({ count: async () => (shown ? 1 : 0), first: () => ({ isVisible: async () => shown, click }) }),
    waitForTimeout: async () => {},
  });
  expect(await answerDiscard(tab(true))).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect(await answerDiscard(tab(false))).toBe(false);
  expect(click).toHaveBeenCalledTimes(1);
  const source = (await import("node:fs")).readFileSync("scripts/dialog-probe.mjs", "utf8");
  expect(source.indexOf("await answerDiscard(tab);")).toBeGreaterThan(source.indexOf('await tab.keyboard.press("Escape");'));
});

it("waits for a read the click started before deciding nothing opened (audit L, 9)", async () => {
  // «Cobrar» reads the bill, then opens. At 700 ms it was a button that opens
  // nothing, so its dialog was never measured.
  const { dialogOpened } = await import("../../../scripts/dialog-probe.mjs");
  let reads = 1; let shown = false;
  const pending = { get size() { return reads; } };
  const tab = {
    isClosed: () => false,
    locator: () => ({ count: async () => (shown ? 1 : 0), first: () => ({ isVisible: async () => shown }) }),
    evaluate: async () => { if (reads > 0) { reads = 0; shown = true; } return { ready: true, signature: "settled" }; },
  };
  expect(await dialogOpened(tab, pending, phaseTimings().phase)).toBe(true);
  // And a button that started nothing is not waited on.
  shown = false; reads = 0;
  const started = Date.now();
  expect(await dialogOpened(tab, pending, phaseTimings().phase)).toBe(false);
  expect(Date.now() - started).toBeLessThan(2000);
});
