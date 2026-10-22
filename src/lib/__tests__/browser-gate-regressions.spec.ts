import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("browser sweeps never report incomplete checks as passing", () => {
  const dialogs = readFileSync("scripts/dialog-check.mjs", "utf8") + readFileSync("scripts/dialog-probe.mjs", "utf8");

  it("does not skip failed navigation", () => {
    expect(dialogs).not.toMatch(/catch\s*\{\s*continue;/);
    expect(dialogs).not.toMatch(/\.goto\([^\n]+\.catch\(\(\) => \{\}\)/);
  });

  it("does not turn page typing errors into an empty audit", () => {
    expect(dialogs).not.toMatch(/typingFaults[^\n]+\.catch\(\(\) => \[\]\)/);
  });

  it("does not leave timed out work in a bare Promise.race", () => {
    expect(dialogs).not.toContain('setTimeout(() => r("timeout"), ms)');
  });

  it("attributes restarts to a listening port", () => {
    expect(readFileSync("scripts/preflight.mjs", "utf8")).not.toContain('pgrep -f next-server');
  });
});
