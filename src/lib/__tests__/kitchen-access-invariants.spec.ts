import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (file: string) => readFileSync(file, "utf8");
const schema = read("supabase/schema.sql");
const policy = (table: string) => [...schema.matchAll(/create policy[\s\S]*?;/g)]
  .map(m => m[0]).filter(p => new RegExp(`on ${table}\\b`).test(p)).join("\n");
it("orders, sittings and split money require the floor, including nested claims", () => {
  for (const table of ["orders", "table_sessions", "bill_splits", "bill_split_claims", "service_requests"]) {
    expect(policy(table), table).not.toMatch(/works_at\(/);
    expect(policy(table), table).toContain("has_role(");
    for (const role of ["manager", "waiter", "cashier"]) expect(policy(table), table).toContain(`'${role}'`);
  }
});
it("kitchen calls stay live without the table credential that opens a public bill", () => {
  const table = schema.match(/create table if not exists kitchen_requests \([\s\S]*?\n\);/)?.[0];
  expect(table).toBeDefined();
  expect(table).not.toMatch(/\b(table_id|session_id|order_id|amount)\b/);
  expect(schema).toContain("alter publication supabase_realtime add table kitchen_requests");
  expect(read("src/app/dashboard/orders/page.tsx")).toContain('kitchen ? "kitchen_requests" : "service_requests"');
  expect(read("src/hooks/useServiceRequests.ts")).toContain('kitchen ? "kitchen_requests" : "service_requests"');
});
it("the kitchen's published rows have an explicit money-free structure", () => {
  const table = schema.match(/create table if not exists kitchen_tickets \([\s\S]*?\n\);/)?.[0];
  expect(table).toBeDefined();
  expect(table).not.toMatch(/\b(total|tip|paid|pay_method|order_id|session_id|table_id|price|discount)\b/);
  expect(schema).toContain("alter table kitchen_tickets enable row level security");
  expect(schema).toContain("grant select on kitchen_tickets to authenticated");
  expect(schema).toContain("alter publication supabase_realtime add table kitchen_tickets");
  expect(policy("kitchen_tickets")).toContain("works_at(restaurant_id)");
  const project = schema.split("create or replace function public.kitchen_items(")[1]?.split("$$;")[0];
  expect(project).toBeDefined();
  expect(project).toContain("kitchen_items(line->'extras')");
  expect(project).toContain("kitchen_items(line->'components')");
  expect(project).not.toMatch(/'price'|'discountPct'|'comboRegular'|line\s*-\s*'/);
  for (const fn of ["kitchen_items(jsonb)", "sync_kitchen_ticket()"]) {
    expect(schema).toContain(`revoke all on function public.${fn} from public, anon, authenticated`);
    expect(read("supabase/drop.sql")).toContain(`drop function if exists public.${fn}`);
  }
});
it("kitchen initial reads and live reads use the same ticket source", () => {
  expect(read("src/app/dashboard/orders/page.tsx")).toContain('kitchen ? "kitchen_tickets" : "orders"');
  expect(read("src/hooks/useRestaurantOrders.ts")).toContain('kitchen ? "kitchen_tickets" : "orders"');
  const print = read("src/app/api/orders/print/route.ts");
  expect(print).toMatch(/to === "receipt"[\s\S]*?actingFrontOfHouse\(/);
});
it("every remaining money store denies the kitchen through policies or grants", () => {
  for (const table of ["payments", "coupons", "coupon_redemptions", "notifications", "refunds_due",
    "discount_requests", "write_off_requests"]) {
    expect(policy(table), table).toContain("has_role(");
    expect(policy(table), table).not.toMatch(/works_at\(|'kitchen'/);
  }
  for (const table of ["payment_allocations", "order_adjustments", "refund_operations", "refund_allocations",
    "refund_attempts", "refund_due_attempts", "cash_shifts", "cash_movements", "terminal_deposits", "platform_fees",
    "offline_sale_queue", "customer_accounts", "account_checkouts", "ingredients", "ingredient_prices", "recipe_lines",
    "waste_entries", "ingredient_purchases", "ingredient_counts", "restaurant_billing_operations",
    "restaurant_subscription_prices", "print_jobs", "loyalty_programs", "loyalty_cards", "loyalty_visits", "loyalty_redemptions"]) {
    const rights = [...schema.matchAll(/(?:revoke|grant)\s+[^;]+;/g)].map(m => m[0])
      .filter(s => new RegExp(`on (?:public\\.)?[^;]*\\b${table}\\b[^;]* (?:from|to) [^;]*\\bauthenticated\\b`).test(s));
    expect(rights.length, table).toBeGreaterThan(0);
    expect(rights.at(-1), table).toMatch(/^revoke all /);
  }
});
