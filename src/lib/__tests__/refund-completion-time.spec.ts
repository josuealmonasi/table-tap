import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => schema.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0];

it("dates a refund's completion when it commits, not when its transaction began (C3)", () => {
  for (const name of ["finish_refund_operation", "complete_refund_operation_v1", "finish_refund_operation_v2"]) {
    const fn = body(name);
    expect(fn, name).not.toMatch(/completed_at = (case when p_status = 'succeeded' then )?now\(\)/);
    expect(fn, name).toContain("clock_timestamp()");
  }
});
