import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Low fixes 2026-11-25 #6: the corte's "on account today" counted account
 * charges cancelled or written off since, which nobody owes. It reads the
 * same orders "still owed" does, limited to today's charges.
 */
it("today's account charges exclude cancelled and written-off orders, as what is owed does", () => {
  const page = readFileSync("src/app/dashboard/analytics/page.tsx", "utf8");
  const read = (what: string) => {
    const end = page.indexOf(`"${what}")`);
    return page.slice(page.lastIndexOf("everyRow<", end), end);
  };
  for (const what of ["today's account charges", "what customer accounts owe"]) {
    const query = read(what);
    expect(query, what).toContain('.neq("status", "cancelled")');
    expect(query, what).toContain('.eq("written_off", false)');
  }
  expect(read("today's account charges")).toContain('.gte("charged_at", since)');
});
