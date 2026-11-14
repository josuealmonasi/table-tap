import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { demoPassword, seedMock } from "../../../scripts/mock-data.mjs";
import { seedTeamLogins, seedTestUsers, TEAM_LOGINS, TEST_USERS } from "../../../scripts/test-users.mjs";
import { loginSecret } from "../../../scripts/login-secrets.mjs";
import { crewCookies } from "../../../scripts/browser-fixtures.mjs";

const { createUser, signInWithPassword } = vi.hoisted(() => ({ createUser: vi.fn(), signInWithPassword: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin: { createUser }, signInWithPassword } }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "unit-test-key");
  createUser.mockReset().mockResolvedValue({ data: { user: { id: "fixture-user" } }, error: null });
  signInWithPassword.mockReset().mockResolvedValue({ data: { session: { access_token: "fixture-token" } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "", "   "])("refuses a missing demo password (%s) instead of using a public fallback", value => {
  vi.stubEnv("DEMO_PASSWORD", value);
  expect(() => demoPassword()).toThrow(/DEMO_PASSWORD.*\.env\.development\.local/);
});

it("reads the demo password after the caller loads its environment, including a later target", () => {
  vi.stubEnv("DEMO_PASSWORD", "first-target-secret");
  expect(demoPassword()).toBe("first-target-secret");
  vi.stubEnv("DEMO_PASSWORD", "second-target-secret");
  expect(demoPassword()).toBe("second-target-secret");
});

it("seeds every test team role with TEST_PASSWORD from the environment", async () => {
  vi.stubEnv("TEST_PASSWORD", "test-team-from-env");
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("from restaurants") ? [{ id: "restaurant" }] : [] }));
  await seedTeamLogins({ query });
  expect(createUser.mock.calls.map(([user]) => user)).toEqual(TEAM_LOGINS.map(member => ({
    email: member.email, password: "test-team-from-env", email_confirm: true,
  })));
});

it("refuses a missing test password before making any database calls", async () => {
  vi.stubEnv("TEST_PASSWORD", "");
  const query = vi.fn(async () => ({ rows: [] }));
  await expect(seedTeamLogins({ query })).rejects.toThrow(/TEST_PASSWORD.*\.env\.development\.local/);
  expect(query).not.toHaveBeenCalled();
  expect(createUser).not.toHaveBeenCalled();
});

it("refuses a missing demo password before deleting or changing demo data", async () => {
  vi.stubEnv("DEMO_PASSWORD", "");
  const query = vi.fn();
  await expect(seedMock({ query })).rejects.toThrow(/DEMO_PASSWORD.*\.env\.development\.local/);
  expect(query).not.toHaveBeenCalled();
  expect(createUser).not.toHaveBeenCalled();
});

it("creates the demo owner with the target password before building its menu", async () => {
  vi.stubEnv("DEMO_PASSWORD", "demo-owner-from-env");
  createUser.mockResolvedValue({ data: null, error: { message: "fixture stops before menu creation" } });
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("from pg_extension") ? [{ nspname: "extensions" }] : [] }));
  await expect(seedMock({ query })).rejects.toThrow("fixture stops before menu creation");
  expect(createUser).toHaveBeenCalledExactlyOnceWith({
    email: "demo@tabletap.dev", password: "demo-owner-from-env", email_confirm: true,
  });
});

it("seeds all five test owners with TEST_PASSWORD", async () => {
  vi.stubEnv("TEST_PASSWORD", "test-owners-from-env");
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("from restaurants") ? [{ id: "restaurant", n: 1 }]
    : sql.includes("count(*)") ? [{ id: "table", n: 1 }] : [] }));
  await seedTestUsers({ query });
  expect(createUser.mock.calls.map(([user]) => user)).toEqual(TEST_USERS.map(user => ({
    email: user.email, password: "test-owners-from-env", email_confirm: true,
  })));
});

it("keeps the five demo logins and roles while signing in with the rotated environment value", async () => {
  vi.stubEnv("DEMO_PASSWORD", "rotated-demo-from-env");
  const crew = [
    { role: "owner", email: "demo@tabletap.dev" },
    ...["manager", "waiter", "cashier", "kitchen"].map(role => ({ role, email: `demo-${role}@tabletap.dev` })),
  ];
  const cookies = await crewCookies(crew, "http://localhost:3100", async (_: string, work: () => Promise<unknown>) => work());
  expect([...cookies.keys()]).toEqual(crew.map(who => who.role));
  expect([...cookies.values()].every(value => value.cookie && !value.error)).toBe(true);
  expect(signInWithPassword.mock.calls.map(([login]) => login)).toEqual(crew.map(who => ({
    email: who.email, password: "rotated-demo-from-env",
  })));
});

it("does not attempt a browser sign-in when DEMO_PASSWORD is missing", async () => {
  vi.stubEnv("DEMO_PASSWORD", "");
  await expect(crewCookies([{ role: "owner", email: "demo@tabletap.dev" }], "http://localhost:3100",
    async (_: string, work: () => Promise<unknown>) => work())).rejects.toThrow(/DEMO_PASSWORD.*\.env\.development\.local/);
  expect(signInWithPassword).not.toHaveBeenCalled();
});

it("reads only the supplied target, preserves password bytes, and names the right env file", () => {
  vi.stubEnv("DEMO_PASSWORD", "other-target-secret");
  expect(loginSecret("DEMO_PASSWORD", { DEMO_PASSWORD: "  quoted secret  " })).toBe("  quoted secret  ");
  expect(() => loginSecret("DEMO_PASSWORD", {}, ".env.production.local"))
    .toThrow("DEMO_PASSWORD is not set. Put it in .env.production.local");
});
