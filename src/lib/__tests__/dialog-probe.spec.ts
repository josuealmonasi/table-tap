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
