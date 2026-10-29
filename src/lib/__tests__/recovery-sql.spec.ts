import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => schema.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0];

it("retires only the latest unanswered app attempt past its key's lifetime (sweep 6, finding 1)", () => {
  const retire = body("retire_unsent_refund_attempt_v1");
  expect(retire).toContain("lock_restaurant_money");
  expect(retire).toContain("a.stripe_refund_id is not null or a.provider_status is not null");
  expect(retire).toContain("now() - interval '24 hours'");
  // And a retired attempt no longer holds the obligation open.
  expect(body("refund_operation_progress_v1")).toContain("'succeeded', 'failed', 'canceled', 'never_sent'");
});

it("leaves a dish counted after a late offline sale as counted (sweep 6, finding 2)", () => {
  expect(body("stock_tracking_epoch")).toContain("new.stock_epoch_at := now();");
  const sale = body("record_offline_sale");
  expect(sale).toContain("m.stock_epoch_at is null or m.stock_epoch_at <= p_at");
  expect(sale).toContain("'completed', p_at, p_terminal, v_demand, false, 0)");
});
