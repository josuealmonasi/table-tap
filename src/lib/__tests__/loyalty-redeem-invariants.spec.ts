import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const read = (file: string) => readFileSync(file, "utf8");
const schema = read("supabase/schema.sql");
const rpc = schema.match(/create or replace function public\.loyalty_redeem_once\([\s\S]*?\$\$;/)?.[0] ?? "";
it("S15 locks the card, replays the saved answer, then checks the round before spending", () => {
  expect(rpc).toContain("for update");
  const replay = rpc.indexOf("return v_prior.request_result");
  const round = rpc.indexOf("if v_card.round_no <> p_round");
  const spend = rpc.indexOf("from public.loyalty_redeem(");
  expect(replay).toBeGreaterThan(rpc.indexOf("for update"));
  expect(round).toBeGreaterThan(replay);
  expect(spend).toBeGreaterThan(round);
  expect(rpc).toContain("v_prior.round_no <> p_round or v_prior.step <> p_step");
  expect(rpc).toContain("request_key = p_request_key, request_result = v_result");
  expect(schema).toContain("on loyalty_redemptions(card_id, request_key) where request_key is not null");
});
it("S15 preserves the deployed RPC and the stamp undo lock and spent-visit guard", () => {
  expect(schema).toContain("function public.loyalty_redeem(p_restaurant uuid, p_code text, p_actor text, p_step int default null)");
  const undo = schema.match(/create or replace function public\.loyalty_unstamp\([\s\S]*?\$\$;/)?.[0] ?? "";
  expect(undo).toContain("from loyalty_cards c where c.id = v_card for update");
  expect(undo).toContain("r.created_at >= v_visit.created_at");
  expect(undo).toContain("return 'spent'");
  expect(undo).toContain("delete from loyalty_visits");
});
it("S15 keeps the new entry point private and includes it in teardown and the grant sweep", () => {
  expect(rpc).toContain("set search_path = public");
  expect(schema).toContain("revoke all on function public.loyalty_redeem_once(uuid, text, text, int, int, uuid) from public, anon, authenticated");
  expect(schema).toContain("grant execute on function public.loyalty_redeem_once(uuid, text, text, int, int, uuid) to service_role");
  expect(read("supabase/drop.sql")).toContain("drop function if exists public.loyalty_redeem_once(uuid, text, text, int, int, uuid)");
  expect(read("scripts/rls-check.mjs")).toContain('["loyalty_redeem_once",');
});
it("S15 both staff screens use saved request identity and receive the displayed round", () => {
  expect(read("src/components/dashboard/loyalty/StampCard.tsx")).toContain("redeemRequest(code, round, step)");
  expect(read("src/components/dashboard/loyalty/CardLookupResult.tsx")).toContain("redeemRequest(card.code, card.round, card.standing.next.visits)");
  expect(read("src/lib/loyalty/server.ts")).toContain("round: card.round_no");
  expect(read("src/app/api/loyalty/lookup/route.ts")).toContain("round: card.round_no");
  for (const messages of [en, es]) {
    expect(messages.apiErr.loyaltyRoundChanged).toBeTruthy();
    expect(messages.loyalty.saveRetry).toBeTruthy();
  }
});
