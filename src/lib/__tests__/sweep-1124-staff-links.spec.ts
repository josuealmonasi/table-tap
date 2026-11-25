import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Security sweep 2026-11-24: a removed member keeps no copied link the owner chose to reset. */
const read = (p: string) => readFileSync(p, "utf8");

it("the account list carries no codes; one account's link is opened on purpose and logged", () => {
  const route = read("src/app/api/accounts/route.ts");
  expect(route).toContain("delete listed.code;");
  expect(route).toContain("await logAccountLinkViewed(actor.restaurantId, actor.email, account.id, account.name);");
  expect(read("src/components/dashboard/accounts/AccountDialog.tsx")).toContain("setCode(d.account?.code ?? null)");
});

it("removal resets the printer link and the opened accounts' links only when asked, after the login goes", () => {
  const staff = read("src/app/api/staff/route.ts");
  const del = staff.slice(staff.indexOf("export async function DELETE"));
  expect(del.indexOf("deleteUser(")).toBeLessThan(del.indexOf("rotatePrintToken("));
  expect(del).toContain("body.resetPrinter === true ? await rotatePrintToken(");
  expect(del).toContain("accountsOpenedBy(actor.restaurantId, member.email)");
});

it("an opened account is found again from its log row", async () => {
  // The parser must read what logDetail writes.
  const { logDetail } = await import("@/lib/log-detail");
  const id = "6b1f0c2e-0000-4000-8000-000000000001";
  const detail = logDetail({ name: "Ana López", link: id });
  expect(/(?:^| )link=([0-9a-f-]{36})(?: |$)/.exec(detail)?.[1]).toBe(id);
  expect(read("src/lib/staff-removal.ts")).toContain("/(?:^| )link=([0-9a-f-]{36})(?: |$)/");
});
