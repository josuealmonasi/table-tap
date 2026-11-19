import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { seededRandom, installSeed } from "../../../scripts/seeded-random.mjs";
import { faultTexts, saveEvidence, slug } from "../../../scripts/layout-evidence.mjs";

it("the same seed gives the same choices, a different one does not", () => {
  const a = seededRandom("tabletap-ci-1"), b = seededRandom("tabletap-ci-1"), c = seededRandom("other");
  const run = (r: () => number) => Array.from({ length: 20 }, r);
  const first = run(a);
  expect(run(b)).toEqual(first);
  expect(run(c)).not.toEqual(first);
  expect(first.every(n => n >= 0 && n < 1)).toBe(true);
});

it("leaves Math.random alone without SEED", () => {
  const before = Math.random;
  expect(installSeed({} as NodeJS.ProcessEnv)).toBeNull();
  expect(Math.random).toBe(before);
});

it("splits a fault into its two sides and names files safely", () => {
  expect(faultTexts([{ text: "Add to cart MX$36.50 / 🌶️ Jalapeños +MX$1.00" }])).toEqual(["Add to cart MX$36.50", "🌶️ Jalapeños +MX$1.00"]);
  expect(slug("360px · diner en · dish detail")).toBe("360px-diner-en-dish-detail");
});

it("saves a screenshot and the boxes only when asked, and never throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-"));
  const shots: string[] = [];
  const tab = {
    url: () => "http://localhost:3000/r/x",
    viewportSize: () => ({ width: 360, height: 800 }),
    evaluate: async () => [{ text: "Add to cart", found: true, rect: { x: 0, y: 700, w: 300, h: 44 }, scroller: null }],
    screenshot: async ({ path }: { path: string }) => { shots.push(path); },
  };
  const faults = [{ kind: "controls-touching", text: "Add to cart / Jalapeños", w: 3.6 }];
  expect(await saveEvidence(tab, "360px · diner en · dish detail", faults, undefined)).toBeNull();
  const name = await saveEvidence(tab, "360px · diner en · dish detail", faults, dir);
  expect(name).toBe("360px-diner-en-dish-detail");
  expect(shots).toEqual([join(dir, `${name}.png`)]);
  const saved = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  expect(saved.elements[0].rect.y).toBe(700);
  expect(saved.viewport).toEqual({ width: 360, height: 800 });
  const broken = { ...tab, screenshot: async () => { throw new Error("browser gone"); } };
  expect(await saveEvidence(broken, "x", faults, dir)).toBeNull();
  expect(existsSync(dir)).toBe(true);
});
