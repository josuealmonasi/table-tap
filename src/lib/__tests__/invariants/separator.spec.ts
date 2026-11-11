import { describe, expect, it } from "vitest";
import { read, walkAll } from "./helpers";

/**
 * A screen's " · " must be SEP (src/lib/separator.ts): a no-break space, the
 * dot, a space. With a plain space before it, a line could start with the dot
 * — "· llegaron MX$571.13" on Analíticas, "· opcional" on the setup checklist
 * (owner's screenshot, 2026-11-10). API routes and library text are left out:
 * they feed logs, Stripe and the kitchen printer, not a wrapping line.
 */
const PLAIN = [/\{" · "\}/, /` · \$\{/, /\} · \$\{/, /\.join\(" · "\)/, /<> · /, /<[a-zA-Z][^<>]*> · /, /">· /];

export function plainSeparators(files: { file: string; src: string }[]): string[] {
  const found: string[] = [];
  for (const { file, src } of files) {
    src.split("\n").forEach((line, n) => {
      if (PLAIN.some(p => p.test(line))) found.push(`${file}:${n + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  return found;
}

describe("separators on a screen never start a line", () => {
  const screens = walkAll("src/components").concat(walkAll("src/app"))
    .filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/api/"))
    .map(file => ({ file, src: read(file) }));

  it("uses SEP wherever a screen joins two facts with a dot", () => {
    expect(screens.length).toBeGreaterThan(100);
    const found = plainSeparators(screens);
    expect(found, `use SEP from "@/lib/separator":\n${found.join("\n")}`).toEqual([]);
  });

  it("catches each way a plain separator gets written", () => {
    const planted = [
      '{" · "}', "{`${a} · ${b}`}", "x.join(\" · \")", "<> · {b}</>", '<span className="m"> · {b}</span>', '<span className="m">· {b}</span>',
    ].map((src, i) => ({ file: `planted${i}.tsx`, src }));
    expect(plainSeparators(planted)).toHaveLength(planted.length);
  });
});
