import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Create and edit refused a frozen restaurant while DELETE did not, for icon
// groups and then dietary tags (Codex sweeps 2 and 3): every verb that writes
// must be guarded, not only the ones somebody remembered.
const ROUTES = ["src/app/api/icon-groups/route.ts", "src/app/api/dietary-tags/route.ts"];

describe("every desk-management write respects the freeze", () => {
  for (const route of ROUTES) {
    it(route, () => {
      const src = readFileSync(route, "utf8");
      for (const verb of ["POST", "PATCH", "DELETE"]) {
        const wrapped = new RegExp(`export const ${verb} = deskMutation\\(`).test(src);
        const plain = src.match(new RegExp(`export async function ${verb}\\([\\s\\S]*?\\n}\\n`))?.[0] ?? "";
        expect(wrapped || plain.includes("frozenBlocks("), `${verb} of ${route}`).toBe(true);
      }
    });
  }
});
