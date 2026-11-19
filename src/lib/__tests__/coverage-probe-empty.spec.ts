import { afterEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ connect: vi.fn(), end: vi.fn(), query: vi.fn() }));
vi.mock("pg", () => ({ default: { Client: class { connect = db.connect; end = db.end; query = db.query; } } }));

afterEach(() => {
  process.exitCode = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  db.query.mockReset();
});

it("fails when the coverage probe finds no restaurant to check", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://devprobe.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgres://devprobe.invalid/db");
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  db.query.mockResolvedValue({ rows: [] });
  await import("../../../scripts/probe-coverage-no-write.mjs");
  expect(process.exitCode).toBe(1);
});

it("fails when every restaurant still needs backfill and none is checked", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://devprobe.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgres://devprobe.invalid/db");
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  db.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select id, name")) return { rows: [{ id: "r", name: "Test" }] };
    if (sql.includes("to_regprocedure") || sql.includes("payment_allocations_need_backfill")) return { rows: [{ value: true }] };
    return { rows: [] };
  });
  await import("../../../scripts/probe-coverage-no-write.mjs");
  expect(process.exitCode).toBe(1);
});

it("fails when the database connection cannot be opened", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://devprobe.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgres://devprobe.invalid/db");
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  db.connect.mockRejectedValueOnce(new Error("connection refused"));
  await expect(import("../../../scripts/probe-coverage-no-write.mjs")).rejects.toThrow("connection refused");
  expect(db.end).toHaveBeenCalled();
});

it("passes when a restaurant was actually checked", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://devprobe.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgres://devprobe.invalid/db");
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  db.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select id, name")) return { rows: [{ id: "r", name: "Test" }] };
    if (sql.includes("to_regprocedure")) return { rows: [{ value: true }] };
    if (sql.includes("payment_allocations_need_backfill") || sql.includes("txid_current")) return { rows: [{ value: false }] };
    if (sql.includes("jsonb_agg") || sql.includes("order_coverage")) return { rows: [{ value: [] }] };
    return { rows: [] };
  });
  await import("../../../scripts/probe-coverage-no-write.mjs");
  expect(process.exitCode || 0).toBe(0);
});
