import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("N10 keeps Vercel's fallback deployable on the production Hobby plan", () => {
  const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
  const recovery = crons.find((cron: { path: string }) => cron.path === "/api/cron/recover");
  // The production preview rejected */5: Hobby permits one daily invocation.
  expect(recovery.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
});

it("starts only the approved main-branch workflow without a stored production secret", () => {
  const workflow = readFileSync(".github/workflows/recovery.yml", "utf8");
  expect(workflow).toContain('cron: "2-59/5 * * * *"');
  expect(workflow).toContain("github.repository == 'josuealmonasi/table-tap' && github.ref == 'refs/heads/main'");
  expect(workflow).toContain("id-token: write");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("node scripts/recover-production.mjs");
  expect(workflow).not.toContain("secrets.");
});
