import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { githubCronAuthorized } from "@/lib/github-cron-auth";

const db = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn(), select: vi.fn(), delete: vi.fn(), lt: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: "https://token.actions.githubusercontent.com", aud: "https://tabletap.shop/api/cron/recover",
  sub: "repo:josuealmonasi/table-tap:ref:refs/heads/main", iat: now, nbf: now - 5, exp: now + 300,
  repository: "josuealmonasi/table-tap", repository_id: "1282544042", repository_owner_id: "5515242",
  ref: "refs/heads/main", event_name: "schedule", runner_environment: "github-hosted",
  workflow_ref: "josuealmonasi/table-tap/.github/workflows/recovery.yml@refs/heads/main",
  jti: "fixture-token-id",
};
let privateKey: CryptoKey, wrongKey: CryptoKey, keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  wrongKey = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture" }] });
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  db.from.mockReturnValue(db);
  db.upsert.mockReturnValue(db);
  db.select.mockReturnValue({ throwOnError: async () => ({ data: [{ jti: claims.jti }] }) });
  db.delete.mockReturnValue(db);
  db.lt.mockReturnValue({ throwOnError: async () => ({ error: null }) });
});
afterEach(() => vi.unstubAllEnvs());

const request = (token: string) => new Request(claims.aud, { headers: { authorization: `Bearer ${token}` } });
const sign = (patch: Record<string, unknown> = {}, key = privateKey) =>
  new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(key);

it.each(["schedule", "workflow_dispatch"])("accepts a signed production recovery job (%s)", async event_name => {
  expect(await githubCronAuthorized(request(await sign({ event_name })), keys)).toBe("authorized");
});

it("accepts the first claim and refuses the same token when no row was inserted", async () => {
  const token = await sign();
  const claim = vi.fn().mockResolvedValueOnce({ data: [{ jti: claims.jti }] }).mockResolvedValueOnce({ data: [] });
  db.select.mockReturnValue({ throwOnError: claim });
  const started = Date.now();

  expect(await githubCronAuthorized(request(token), keys)).toBe("authorized");
  expect(await githubCronAuthorized(request(token), keys)).toBe("unauthorized");
  expect(db.from).toHaveBeenCalledWith("cron_token_claims");
  expect(db.upsert).toHaveBeenCalledWith(
    { jti: claims.jti, expires_at: new Date(claims.exp * 1000).toISOString() },
    { onConflict: "jti", ignoreDuplicates: true },
  );
  expect(db.select).toHaveBeenCalledWith("jti");
  expect(db.lt).toHaveBeenCalledOnce();
  const [column, cutoff] = db.lt.mock.calls[0];
  expect(column).toBe("expires_at");
  expect(Date.parse(cutoff)).toBeGreaterThanOrEqual(started - 86_400_000);
  expect(Date.parse(cutoff)).toBeLessThanOrEqual(Date.now() - 86_400_000);
});

it("fails closed when the claim write errors", async () => {
  db.select.mockReturnValue({ throwOnError: vi.fn().mockRejectedValue(new Error("offline")) });
  expect(await githubCronAuthorized(request(await sign()), keys)).toBe("unavailable");
  expect(db.delete).not.toHaveBeenCalled();
});

it("accepts a claimed token when cleanup fails", async () => {
  db.lt.mockReturnValue({ throwOnError: vi.fn().mockRejectedValue(new Error("offline")) });
  expect(await githubCronAuthorized(request(await sign()), keys)).toBe("authorized");
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
  { jti: "" }, { jti: 42 },
])("refuses an identity outside the exact trusted job (%j)", async patch => {
  expect(await githubCronAuthorized(request(await sign(patch)), keys)).toBe("unauthorized");
  expect(db.upsert).not.toHaveBeenCalled();
});

it.each(["exp", "iat", "nbf", "jti"])("requires the signed %s claim", async field => {
  const payload: Record<string, unknown> = { ...claims };
  delete payload[field];
  const token = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(privateKey);
  expect(await githubCronAuthorized(request(token), keys)).toBe("unauthorized");
  expect(db.upsert).not.toHaveBeenCalled();
});

it("refuses a forged signature and a symmetric algorithm", async () => {
  expect(await githubCronAuthorized(request(await sign({}, wrongKey)), keys)).toBe("unauthorized");
  const token = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("unit-only-signing-material-with-enough-bytes"));
  expect(await githubCronAuthorized(request(token), keys)).toBe("unauthorized");
  expect(db.upsert).not.toHaveBeenCalled();
});

it.each(["development", "preview", undefined])("never accepts the production identity in %s", async env => {
  vi.stubEnv("VERCEL_ENV", env);
  const lookup = vi.fn(() => { throw new Error("must not read keys"); });
  expect(await githubCronAuthorized(request(await sign()), lookup)).toBe("unauthorized");
  expect(lookup).not.toHaveBeenCalled();
});

it("refuses malformed or oversized authorization without reading keys", async () => {
  const lookup = vi.fn(() => { throw new Error("must not read keys"); });
  for (const value of ["", "Basic fake", "Bearer fake", `Bearer ${"a".repeat(8192)}.b.c`]) {
    expect(await githubCronAuthorized(new Request(claims.aud, { headers: { authorization: value } }), lookup)).toBe("unauthorized");
  }
  expect(lookup).not.toHaveBeenCalled();
});

it("keeps recovery closed when signing keys cannot be read", async () => {
  const lookup = vi.fn(async () => { throw new Error("provider unavailable"); });
  expect(await githubCronAuthorized(request(await sign()), lookup)).toBe("unauthorized");
});
