import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

it("audit #648: the backup job runs on a fixed Node from a SHA-pinned setup-node", () => {
  const workflow = readFileSync(".github/workflows/recovery.yml", "utf8");
  expect(workflow).toMatch(/uses: actions\/setup-node@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  expect(workflow).toContain('node-version: "22"');
  for (const use of workflow.match(/uses: \S+/g) ?? []) expect(use).toMatch(/@[0-9a-f]{40}$/);
});

describe("audit #648: the database's five-minute recovery job", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const drop = readFileSync("supabase/drop.sql", "utf8");
  const tail = schema.slice(schema.lastIndexOf("create extension if not exists pg_cron;"));
  const job = tail.slice(tail.indexOf("$job$"), tail.lastIndexOf("$job$"));

  it("installs pg_cron and pg_net, and replaces the job by its fixed name", () => {
    expect(tail).toContain("create extension if not exists pg_net;");
    expect(tail.indexOf("perform cron.unschedule('tabletap-recover')")).toBeLessThan(tail.indexOf("select cron.schedule('tabletap-recover', '*/5 * * * *'"));
    expect(drop).toContain("perform cron.unschedule('tabletap-recover');");
  });

  it("posts a one-time signature without putting the Vault secret in the queue", () => {
    expect(job).toContain("net.http_post(");
    expect(job).toContain("url := 'https://tabletap.shop/api/cron/recover'");
    expect(job).not.toContain("'Bearer ' || s.decrypted_secret");
    expect(job).toContain("'X-Recover-Signature'");
    expect(job).toContain("hmac(");
    expect(job).toContain("from vault.decrypted_secrets s");
    expect(job).toContain("where s.name = 'recovery_signing_secret' and coalesce(s.decrypted_secret, '') <> ''");
  });

  it("does nothing on a project without the secret: the call is a select over the Vault row", () => {
    // No row, no call. Dev never sets the secret, so dev never calls production.
    expect(job).toContain("select net.http_post(");
    expect(job).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
    expect(job).toContain("limit 1");
  });
});
