import { readFileSync, readdirSync } from "node:fs";
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

/** Every loading screen in the app. */
function skeletons(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "loading.tsx") out.push(full);
    }
  };
  walk("src/app");
  return out;
}

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

/**
 * A skeleton draws the shape of a screen, not its structure.
 *
 * The till's loading state reused `.tt-pos-total`, which carries a 2px rule in
 * near-black to separate the cart lines from the total. Among a panel of soft
 * grey blocks that line read as a fault — somebody asked whether the page was
 * broken — because a rule is only structure when there is something under it
 * to structure.
 *
 * The rule is not that a skeleton may never borrow a class: borrowing is what
 * keeps the shape honest, and the geometry has to be the real geometry or the
 * page jumps when the data lands. The rule is that a borrowed class which
 * paints INK must come with the modifier that takes the ink out and leaves the
 * space, so the skeleton occupies the same box while drawing nothing.
 */
describe("a skeleton draws shape, not structure", () => {
  const css = readFileSync(CSS, "utf8");

  /** Classes whose rule is painted in ink rather than in the soft line colour. */
  function inkRuled(source: string): Set<string> {
    const out = new Set<string>();
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
    for (const block of bare.matchAll(/\.([a-z0-9-]+)\s*\{([^}]*)\}/gi)) {
      const [, name, body] = block;
      if (/border[a-z-]*:[^;]*var\(--tt-ink\)/i.test(body)) out.add(name);
    }
    return out;
  }

  it("finds the ink-ruled classes to check", () => {
    // A scan that matches nothing must fail loudly rather than pass on zero.
    expect(inkRuled(css).size).toBeGreaterThan(0);
  });

  it("never lets a loading screen paint an ink rule", () => {
    const inked = inkRuled(css);
    const offenders: string[] = [];

    for (const file of skeletons()) {
      const source = readFileSync(file, "utf8");
      for (const attr of source.matchAll(/className="([^"]+)"/g)) {
        const classes = attr[1].split(/\s+/).filter(Boolean);
        for (const c of classes) {
          // The modifier that empties it must be applied in the same place.
          if (inked.has(c) && !classes.includes(`${c}-loading`)) {
            offenders.push(`${file}: .${c} draws a rule in ink — add .${c}-loading beside it`);
          }
        }
      }
    }

    expect(
      offenders,
      `a skeleton is painting structure it does not have yet:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("gives every such modifier a transparent border, not a missing one", () => {
    // `border: none` would collapse the box and move everything up by 2px the
    // moment the real screen arrived. Transparent keeps the space.
    for (const c of inkRuled(css)) {
      const mod = new RegExp(`\\.${c}-loading\\s*\\{([^}]*)\\}`, "i");
      const found = css.match(mod);
      if (!found) continue;
      expect(found[1], `.${c}-loading must keep its space`).toMatch(/border[a-z-]*-color:\s*transparent/i);
      expect(found[1], `.${c}-loading must not remove the border`).not.toMatch(/border[a-z-]*:\s*(none|0)/i);
    }
  });
});
