import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { messagesFor } from "@/lib/i18n";

/** Every leaf key in a catalog, as dotted paths. */
function keysOf(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !full.includes("__tests__") ? [full] : [];
  });
}

const en = keysOf(messagesFor("en"));
const es = keysOf(messagesFor("es"));

describe("the two catalogs say the same things", () => {
  it("has no key in English that Spanish is missing", () => {
    expect(en.filter(k => !es.includes(k))).toEqual([]);
  });

  it("has no key in Spanish that English is missing", () => {
    expect(es.filter(k => !en.includes(k))).toEqual([]);
  });
});

describe("every key the app asks for exists", () => {
  // t("a.b") and t(`a.${x}`) — the literal ones are checkable, and the
  // interpolated ones are listed so a reviewer can see what was skipped.
  const LITERAL = /\bt\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
  const KEY_PROP = /\b(?:labelKey|titleKey|descKey|headlineKey)\s*[:=]\s*"([^"]+)"/g;

  const used = new Set<string>();
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(LITERAL)) used.add(m[1]);
    for (const m of text.matchAll(KEY_PROP)) used.add(m[1]);
  }

  it("resolves every literal key in both languages", () => {
    const missing = [...used].filter(k => !en.includes(k) || !es.includes(k));
    expect(missing).toEqual([]);
  });
});
