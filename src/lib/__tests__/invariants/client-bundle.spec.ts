import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * A client file must never reach the server's request APIs.
 *
 * The navbar's sign-out hook imported one role helper from `membership.ts`,
 * which reads the session through `next/headers`; Next refused the bundle and
 * every page answered 500 (Train A gate, 2026-10-29). tsc, lint and the unit
 * tests were all green: only a running dev server noticed. This follows every
 * value import from each "use client" file, the way the bundler does.
 */
const SERVER_ONLY = ["src/lib/supabase/server.ts", "src/lib/i18n/server.ts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "__stories__" ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function resolve(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = `src/${spec.slice(2)}`;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const sources = new Map<string, string>();
const read = (path: string): string => {
  if (!sources.has(path)) sources.set(path, readFileSync(path, "utf8"));
  return sources.get(path)!;
};

/** Value imports only: `import type` and `export type` vanish from the bundle. */
function imports(path: string): string[] {
  const out: string[] = [];
  const source = read(path);
  for (const m of source.matchAll(/^(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) out.push(m[1]);
  return out;
}

function reachesServer(start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (path: string, trail: string[]): string[] | null => {
    if (seen.has(path)) return null;
    seen.add(path);
    // A server action is called across the wire, not bundled.
    if (/^["']use server["']/m.test(read(path))) return null;
    if (SERVER_ONLY.includes(path)) return trail;
    for (const spec of imports(path)) {
      if (spec === "next/headers") return [...trail, spec];
      const next = resolve(spec);
      if (next) {
        const found = walk(next, [...trail, next]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(start, [start]);
}

it("no client file imports, however indirectly, what only the server can run", () => {
  const client = files("src").filter(path => /^["']use client["']/m.test(read(path)));
  expect(client.length).toBeGreaterThan(50);
  const leaks = client.map(reachesServer).filter((trail): trail is string[] => trail !== null).map(trail => trail.join(" → "));
  expect(leaks).toEqual([]);
});
