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
function apiErrorKeys(dir: string, found = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) apiErrorKeys(path, found);
    else if (path.endsWith(".ts")) {
      for (const m of readFileSync(path, "utf8").matchAll(/apiError\(\s*"([^"]+)"/g)) {
        if (!found.has(m[1])) found.set(m[1], path);
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
