import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const page = readFileSync("src/app/dashboard/bills/page.tsx", "utf8");

it("reads every outstanding order, filtered before paging (journey B, finding 4)", () => {
  const read = page.slice(page.indexOf('.from("orders")'), page.indexOf('"the open bills"'));
  expect(read).toContain('.eq("written_off", false)');
  expect(read).toContain('.not("status", "in", "(pending_payment,cancelled)")');
  expect(read).toContain(".range(a, b)");
  expect(read).not.toContain(".limit(");
});
