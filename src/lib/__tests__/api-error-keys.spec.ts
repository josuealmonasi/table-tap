import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

/**
 * Every key a route hands to `apiError` resolves to a sentence.
 *
 * `translate` returns the key itself when it cannot find one, so a missing
 * string does not throw — it puts `apiErr.nothingToWriteOff` in a toast and
 * calls it a day. That is what a manager saw when they approved a write-off
 * for a bill somebody had already collected on: the money was handled
 * correctly, the message was an internal identifier.
 *
 * Two places that had to agree — the routes and the dictionary — with nothing
 * comparing them.
 */
/** The source between `apiError(` and its matching `)`. */
function callArgs(src: string, from: number): string {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

function apiErrorKeys(dir: string, found = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) apiErrorKeys(path, found);
    else if (path.endsWith(".ts")) {
      const src = readFileSync(path, "utf8");
      // Not `apiError("literal"` — the first argument is often a ternary, and
      // reading only the literal form left 8 of 241 calls unchecked, including
      // every branch of `already ? … : mailer ? … : …`. Read the whole call and
      // take every key-shaped string in it.
      for (const m of src.matchAll(/apiError\(/g)) {
        const args = callArgs(src, m.index + m[0].length);
        for (const k of args.matchAll(/"([A-Za-z][\w]*(?:\.[\w]+)+)"/g)) {
          if (!found.has(k[1])) found.set(k[1], path);
        }
      }
    }
  }
  return found;
}

describe("an API error is a sentence, never a key", () => {
  const keys = [...apiErrorKeys("src/app/api")];

  it("finds the keys to check", () => {
    // If the scan breaks, the test must fail loudly rather than pass on zero.
    expect(keys.length).toBeGreaterThan(50);
  });

  it.each<Locale>(["es", "en"])("resolves every key in %s", locale => {
    const messages = messagesFor(locale);
    const leaking = keys
      .filter(([key]) => translate(messages, key, {}) === key)
      .map(([key, where]) => `${key} — used by ${where}`);
    expect(
      leaking,
      `these would show the raw key to the user in ${locale}:\n${leaking.join("\n")}`,
    ).toEqual([]);
  });
});
