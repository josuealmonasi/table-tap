import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { formatAgo } from "@/lib/elapsed";
import { read, walkAll } from "./helpers";

/**
 * An elapsed time on a screen goes through src/lib/elapsed.ts. The orders
 * board printed "hace 1741 min" for a ticket a day and five hours old: its
 * dictionary key took a raw count of minutes, and the request chips and the
 * bills list each had their own rounding (owner report, 2026-11-12).
 */

/** "{n} min", "{m}m ago", "hace {x}", "{h} h" — a count with a unit of time. */
const TIME_UNIT = /\{\w+\}\s?(?:min|m|h|d)(?![\p{L}\d])|\bhace \{|\{\w+\} ago\b/u;

function flatten(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

export function rawTimeMessages(dict: unknown): string[] {
  return flatten(dict)
    .filter(([key, text]) => !key.startsWith("elapsed.") && TIME_UNIT.test(text))
    .map(([key, text]) => `${key}: ${text}`);
}

/** A screen working out minutes itself, instead of asking elapsed.ts. */
const RAW_MINUTES = [/\/\s*60_?000\b/, /\/\s*1000\s*\/\s*60\b/, /\$\{\w+\}m\b/, /\$\{[^}]+\}h \$\{/];

export function screensCountingMinutes(files: { file: string; src: string }[]): string[] {
  const found: string[] = [];
  for (const { file, src } of files) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    code.split("\n").forEach((line, n) => {
      if (RAW_MINUTES.some(p => p.test(line))) found.push(`${file}:${n + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  return found;
}

describe("an elapsed time never reads as a pile of minutes", () => {
  it("has no message outside `elapsed` that takes a raw count of time", () => {
    const found = [...rawTimeMessages(en), ...rawTimeMessages(es)];
    expect(found, `format the time with src/lib/elapsed.ts and pass it whole:\n${found.join("\n")}`).toEqual([]);
  });

  it("catches each shape the old keys had", () => {
    const planted = { a: "hace {n} min", b: "{m}m ago", c: "{h}h ago", d: "{d} d", e: "waiting {n} min" };
    expect(rawTimeMessages(planted)).toHaveLength(5);
    expect(rawTimeMessages({ ok: "quedan {days} días", px: "{min}px", t: "esperando {time}" })).toEqual([]);
  });

  it("leaves dividing by a minute to elapsed.ts on every screen", () => {
    const screens = [...walkAll("src/components"), ...walkAll("src/app"), ...walkAll("src/hooks")]
      .filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/api/"))
      .map(file => ({ file, src: read(file) }));
    expect(screens.length).toBeGreaterThan(100);
    const found = screensCountingMinutes(screens);
    expect(found, `use formatAgo / formatDuration from "@/lib/elapsed":\n${found.join("\n")}`).toEqual([]);
    const planted = ["(now - t) / 60_000", "(now - t) / 60000", "ms / 1000 / 60", "`${mins}m`", "`${hours}h ${mins % 60}m`"]
      .map((src, i) => ({ file: `planted${i}.tsx`, src }));
    expect(screensCountingMinutes(planted)).toHaveLength(planted.length);
  });

  it("routes every screen that shows a wait through the formatter", () => {
    for (const file of [
      "src/components/dashboard/TicketWait.tsx",
      "src/components/dashboard/ServiceRequestsBar.tsx",
      "src/components/dashboard/OpenBillRow.tsx",
    ]) {
      expect(read(file), file).toMatch(/from "@\/lib\/elapsed"/);
    }
  });

  it("says the board's 1741 minutes as a day and five hours", () => {
    const now = Date.parse("2026-11-12T18:00:00Z");
    const placed = now - 1741 * 60_000;
    expect(formatAgo(placed, now, "es")).toBe("hace 1 d 5 h");
    expect(formatAgo(placed, now, "en")).toBe("1 d 5 h ago");
    // No wider than the sentence it replaced.
    expect(formatAgo(placed, now, "es").length).toBeLessThanOrEqual("hace 1741 min".length);
  });
});
