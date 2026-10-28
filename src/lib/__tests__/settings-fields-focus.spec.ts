import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Settings saves a field when you leave it, and every card shares one
// `saving` flag. A text field disabled while it is true loses the cursor the
// moment you tab into it from a field that just saved: the ticket times and
// the stock threshold both did (pnpm dialogs). Toggles and buttons may wait.
it("no Settings text field is disabled while another field saves", () => {
  const dir = "src/components/dashboard/settings";
  const offenders: string[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith(".tsx"))) {
    const source = readFileSync(`${dir}/${file}`, "utf8");
    for (const [element] of source.matchAll(/<(input|textarea)\b[\s\S]*?\/>/g)) {
      if (/type="(checkbox|radio|file)"/.test(element)) continue;
      if (/disabled=\{[^}]*\bsaving\b/.test(element)) offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
