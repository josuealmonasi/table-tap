import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every design token a stylesheet uses is a token that exists.
 *
 * CSS fails silently at this: `border: 1px solid var(--tt-border)` where no
 * such token is defined does not error, does not warn, and does not draw a
 * border. It renders as nothing, and the screen looks unfinished rather than
 * broken — which is exactly how the counter till shipped its first draft with
 * no card edges at all, its tiles bare text on the page.
 *
 * The token was invented from memory instead of read from the file. This is
 * the check that makes reading unnecessary: a name that is not defined fails
 * here, in a second, instead of in front of somebody.
 */
const CSS = "src/app/globals.css";

/** `--tt-x: value` — a token being given a value, not merely mentioned. */
function defined(css: string): Set<string> {
  return new Set([...css.matchAll(/(--tt-[a-z0-9-]+)\s*:/gi)].map(m => m[1]));
}

/**
 * `var(--tt-x)` asked for with NO fallback — the only form that can silently
 * draw nothing.
 *
 * `var(--tt-serif, inherit)` is a deliberate choice: the author said what
 * happens when it is absent, so absence is not a bug. `--tt-font` is handed in
 * by next/font rather than written in CSS, and is used exactly that way, with
 * the fallback inside the parentheses — the comment above it explains that a
 * bare one would invalidate the whole declaration and fall back to Times.
 */
function usedWithoutFallback(css: string): Map<string, number> {
  const out = new Map<string, number>();
  // A token named in a comment is prose ABOUT the token — the note above
  // `--tt-font` writes `var(--tt-font)` to explain why the real one carries a
  // fallback, and reading that as a use flagged a line that is correct.
  // Blanked rather than dropped, so the line numbers still point somewhere.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  code.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--tt-[a-z0-9-]+)\s*([,)])/gi)) {
      if (m[2] === ")" && !out.has(m[1])) out.set(m[1], i + 1);
    }
  });
  return out;
}

describe("a stylesheet only asks for tokens that exist", () => {
  const css = readFileSync(CSS, "utf8");

  it("finds the tokens to check", () => {
    // If the scan breaks it must fail loudly rather than pass on zero.
    expect(defined(css).size).toBeGreaterThan(20);
    expect(usedWithoutFallback(css).size).toBeGreaterThan(20);
  });

  it("defines every token globals.css uses", () => {
    const have = defined(css);
    const missing = [...usedWithoutFallback(css)]
      .filter(([name]) => !have.has(name))
      .map(([name, line]) => `${CSS}:${line}  var(${name})`);

    expect(
      missing,
      `these resolve to nothing and draw nothing — CSS will not tell you:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
