import { expect, it } from "vitest";
import { runProbes } from "../../../scripts/probes.mjs";

it("fails the gate when a probe cannot connect", async () => {
  const result = await runProbes(["connection"], async () => ({ code: 1, error: "connection refused" }));
  expect(result).toBe(false);
});

it("fails the gate when a probe cannot start", async () => {
  const result = await runProbes(["missing"], async () => { throw new Error("spawn failed"); });
  expect(result).toBe(false);
});

it("passes only when every probe passed, and never on an empty list", async () => {
  expect(await runProbes(["a", "b"], async () => ({ code: 0 }))).toBe(true);
  expect(await runProbes(["a", "b"], async name => ({ code: name === "b" ? 1 : 0 }))).toBe(false);
  expect(await runProbes([], async () => ({ code: 0 }))).toBe(false);
});
