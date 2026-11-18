import { expect, it } from "vitest";
import { accountsCases } from "../../../scripts/api-cases/accounts.mjs";

it("covers staff, code removal, retry and unknown codes in the API gate", () => {
  const cases = accountsCases({ accountId: "a", accountCode: "ZMYKTJ6GDA2Y", dish: {}, emails: {} });
  const removal = cases.filter((c: { path: string }) => c.path === "/api/account/remove-email");
  expect(removal.some((c: { as: string; expect: number[] }) => c.as === "manager" && c.expect.includes(200))).toBe(true);
  expect(removal.some((c: { as: string; name: string }) => c.as === "diner" && /retry/i.test(c.name))).toBe(true);
  expect(removal.some((c: { as: string; expect: number[] }) => c.as === "diner" && c.expect.includes(404))).toBe(true);
});
