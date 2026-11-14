import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { githubCronAuthorized } from "@/lib/github-cron-auth";

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: "https://token.actions.githubusercontent.com", aud: "https://tabletap.shop/api/cron/recover",
  sub: "repo:josuealmonasi/table-tap:ref:refs/heads/main", iat: now, nbf: now - 5, exp: now + 300,
  repository: "josuealmonasi/table-tap", repository_id: "1282544042", repository_owner_id: "5515242",
  ref: "refs/heads/main", event_name: "schedule", runner_environment: "github-hosted",
  workflow_ref: "josuealmonasi/table-tap/.github/workflows/recovery.yml@refs/heads/main",
};
let privateKey: CryptoKey, wrongKey: CryptoKey, keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  wrongKey = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture" }] });
});
beforeEach(() => vi.stubEnv("VERCEL_ENV", "production"));
afterEach(() => vi.unstubAllEnvs());

const request = (token: string) => new Request(claims.aud, { headers: { authorization: `Bearer ${token}` } });
const sign = (patch: Record<string, unknown> = {}, key = privateKey) =>
  new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(key);

it.each(["schedule", "workflow_dispatch"])("accepts a signed production recovery job (%s)", async event_name => {
  expect(await githubCronAuthorized(request(await sign({ event_name })), keys)).toBe(true);
});

it.each([
  { iss: "https://attacker.example" }, { aud: "https://another.example/api/cron/recover" },
  { sub: "repo:josuealmonasi/table-tap:pull_request" }, { repository: "attacker/table-tap" },
  { repository_id: "different-repository" }, { repository_owner_id: "different-owner" },
  { ref: "refs/heads/feature" }, { event_name: "pull_request" }, { event_name: "pull_request_target" },
  { workflow_ref: "josuealmonasi/table-tap/.github/workflows/ci.yml@refs/heads/main" },
  { workflow_ref: "josuealmonasi/table-tap/.github/workflows/recovery.yml@refs/heads/feature" },
  { job_workflow_ref: "attacker/worker/.github/workflows/recover.yml@refs/heads/main" },
  { runner_environment: "self-hosted" }, { exp: now - 60 }, { nbf: now + 60 }, { iat: now - 600 },
])("refuses an identity outside the exact trusted job (%j)", async patch => {
  expect(await githubCronAuthorized(request(await sign(patch)), keys)).toBe(false);
});

it.each(["exp", "iat", "nbf"])("requires the signed %s lifetime claim", async field => {
  const payload: Record<string, unknown> = { ...claims };
  delete payload[field];
  const token = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(privateKey);
  expect(await githubCronAuthorized(request(token), keys)).toBe(false);
});

it("refuses a forged signature and a symmetric algorithm", async () => {
  expect(await githubCronAuthorized(request(await sign({}, wrongKey)), keys)).toBe(false);
  const token = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("unit-only-signing-material-with-enough-bytes"));
  expect(await githubCronAuthorized(request(token), keys)).toBe(false);
});

it.each(["development", "preview", undefined])("never accepts the production identity in %s", async env => {
  vi.stubEnv("VERCEL_ENV", env);
  const lookup = vi.fn(() => { throw new Error("must not read keys"); });
  expect(await githubCronAuthorized(request(await sign()), lookup)).toBe(false);
  expect(lookup).not.toHaveBeenCalled();
});

it("refuses malformed or oversized authorization without reading keys", async () => {
  const lookup = vi.fn(() => { throw new Error("must not read keys"); });
  for (const value of ["", "Basic fake", "Bearer fake", `Bearer ${"a".repeat(8192)}.b.c`]) {
    expect(await githubCronAuthorized(new Request(claims.aud, { headers: { authorization: value } }), lookup)).toBe(false);
  }
  expect(lookup).not.toHaveBeenCalled();
});

it("keeps recovery closed when signing keys cannot be read", async () => {
  const lookup = vi.fn(async () => { throw new Error("provider unavailable"); });
  expect(await githubCronAuthorized(request(await sign()), lookup)).toBe(false);
});
