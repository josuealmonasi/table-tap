import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * Next's build checks route handler signatures; tsc does not. `GET(req?: NextRequest)`
 * passed tsc, lint and every unit test, and failed every Vercel build of the
 * branch and of everything merged after it (2026-11-09).
 */
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : [];
  });
}

it("no route handler takes an optional first argument", () => {
  const bad = routes("src/app").filter(path =>
    /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\s*\w+\?\s*:/.test(readFileSync(path, "utf8")));
  expect(bad).toEqual([]);
});
