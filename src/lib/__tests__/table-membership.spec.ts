import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashMemberToken, MEMBER_COOKIE, newMemberToken } from "@/lib/table-member-cookie";

const db = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: false, filters: [] as unknown[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let rows = db.rows[table] ?? [];
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { db.filters.push([table, key, value]); rows = rows.filter(row => row[key] === value); return q; },
    is: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return q; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: db.fail ? { message: "offline" } : null }),
  };
  return q;
} }) }));
const { tableMember } = await import("@/lib/table-membership");
const token = newMemberToken();
const req = (cookie = token) => new NextRequest("https://test", { headers: { cookie: `${MEMBER_COOKIE}=${cookie}` } });
const session = (id: string, closed_at: string | null = null) => ({ id, restaurant_id: "r", table_id: "t", opened_at: new Date().toISOString(), closed_at });

beforeEach(() => {
  db.fail = false;
  db.filters = [];
  db.rows = {
    table_sessions: [session("current")],
    table_session_members: [{ id: "member", session_id: "current", token_hash: hashMemberToken(token), status: "approved" }],
  };
});

describe("only the server credential proves admission", () => {
  it("lets an approved phone read its sitting and derives its diner from that row", async () => {
    expect(await tableMember(req(), "r", "t")).toMatchObject({ id: "member", sessionId: "current", closed: false });
    expect(db.filters).toContainEqual(["table_session_members", "token_hash", hashMemberToken(token)]);
  });
  it.each(["pending", "rejected"])("refuses a %s phone", async status => {
    db.rows.table_session_members[0].status = status;
    expect(await tableMember(req(), "r", "t")).toBeNull();
  });
  it("does not accept a member id or a hash as the cookie", async () => {
    expect(await tableMember(req("member"), "r", "t")).toBeNull();
    expect(await tableMember(req(hashMemberToken(token)), "r", "t")).toBeNull();
    expect(await tableMember(req(newMemberToken()), "r", "t")).toBeNull();
  });
  it("does not let an earlier party read the new sitting", async () => {
    db.rows.table_sessions.push(session("earlier", new Date().toISOString()));
    db.rows.table_session_members[0].session_id = "earlier";
    expect(await tableMember(req(), "r", "t")).toBeNull();
    expect(await tableMember(req(), "r", "t", "current", true)).toBeNull();
  });
  it("keeps the earlier member's own food payable after closure and expiry", async () => {
    db.rows.table_sessions = [session("earlier", new Date().toISOString())];
    db.rows.table_sessions[0].opened_at = "2020-01-01T00:00:00Z";
    db.rows.table_session_members[0].session_id = "earlier";
    expect(await tableMember(req(), "r", "t", "earlier", true)).toMatchObject({ id: "member", closed: true });
    expect(await tableMember(req(), "r", "t", "earlier")).toBeNull();
  });
  it("does not pair a real member with another restaurant or table", async () => {
    expect(await tableMember(req(), "other", "t", "current", true)).toBeNull();
    expect(await tableMember(req(), "r", "other", "current", true)).toBeNull();
  });
  it("fails closed when membership cannot be read", async () => {
    db.fail = true;
    await expect(tableMember(req(), "r", "t")).rejects.toThrow();
  });
});
