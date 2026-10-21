import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OPEN_BILL_HOURS } from "@/lib/table-bill";
import { MEMBER_POLL_MS } from "@/lib/poll";
const read = (path: string) => readFileSync(path, "utf8");
const schema = read("supabase/schema.sql");

it("keeps the credential table private and included in reset and public-key sweeps", () => {
  expect(schema).toContain("alter table table_session_members enable row level security");
  expect(schema).toContain("revoke all on table_session_members from anon");
  expect(schema).toContain("revoke all on table_session_members from public, authenticated");
  expect(schema).not.toMatch(/grant select on table_session_members to (?:anon|authenticated)/);
  expect(read("supabase/drop.sql")).toContain("drop table if exists table_session_members cascade");
  expect(read("scripts/rls-check.mjs")).toContain('"table_session_members"');
});
it("decides the first phone under a table lock, with the same sitting lifetime as the app", () => {
  const request = schema.split("create or replace function public.request_table_member(")[1].split("end; $$;")[0];
  expect(request.indexOf("for update")).toBeLessThan(request.indexOf("insert into table_sessions"));
  expect(request).toContain("case when v_created then 'approved' else 'pending' end");
  expect(request).toContain(`interval '${OPEN_BILL_HOURS} hours'`);
  const decide = schema.split("create or replace function public.decide_table_member(")[1].split("end; $$;")[0];
  expect(decide).toContain("s.restaurant_id = p_restaurant and s.table_id = p_table");
  expect(decide).toContain("s.closed_at is null");
  expect(decide).toContain("session_id = v_session and token_hash = p_hash and status = 'approved'");
  expect(decide).toContain("and status = 'pending'");
});
it("bill, splits and new orders derive the diner from the verified membership", () => {
  for (const route of ["split/route.ts", "split/join/route.ts", "split/pay/route.ts"]) {
    const code = read(`src/app/api/${route}`);
    expect(code).toContain("await tableMember(req");
    expect(code).toContain("const diner = member.id");
  }
  expect(read("src/app/api/checkout/route.ts")).toContain("diner: admission?.diner ?? body.diner");
  expect(read("src/lib/bill-data.ts")).not.toContain("mine ??");
  expect(read("src/lib/table-party-server.ts")).toContain('.eq("session_id", sessionId)');
  expect(read("src/app/api/bill/pay/route.ts")).not.toContain("billWindowStart");
});
it("keeps both admission screens live by polling, without granting browsers the credential rows", () => {
  expect(MEMBER_POLL_MS).toBe(5000);
  for (const path of ["src/hooks/useTableMembership.ts", "src/hooks/usePendingPhones.ts"]) {
    expect(read(path)).toContain("setInterval(read, MEMBER_POLL_MS)");
    expect(read(path)).toContain("clearInterval(timer)");
  }
  expect(read("src/components/dashboard/ServiceRequestsBar.tsx")).toContain("usePendingPhones(restaurantId, canSettle)");
  expect(read("src/app/api/table-membership/route.ts")).toContain("actingFrontOfHouse()");
});
