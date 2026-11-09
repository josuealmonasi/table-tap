import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ error: null as { message: string } | null, allowed: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: state.error }) };
  return q;
} }) }));
vi.mock("@/lib/page-guard", () => ({ requireManager: async () => ({ role: "owner", restaurant: { id: "r", name: "Cafe" } }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }), allPlans: async () => [] }));
vi.mock("@/lib/plan", () => ({ can: () => state.allowed, cheapestWith: () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/dashboard/loyalty/LoyaltyAdmin", () => ({ default: () => <form>Editable program</form> }));
vi.mock("@/components/dashboard/plan/PlanLock", () => ({ default: () => <div>Plan lock</div> }));
import LoyaltyPage from "@/app/dashboard/loyalty/page";
beforeEach(() => { vi.stubGlobal("React", React); state.error = null; state.allowed = true; });
it.each([true, false])("D7: a failed read offers retry without an empty editor or hidden earned rewards (plan=%s)", async allowed => {
  state.allowed = allowed; state.error = { message: "temporary failure" };
  const html = renderToStaticMarkup(await LoyaltyPage());
  expect(html).toContain("loyalty.readFailed"); expect(html).toContain("fallback.retry");
  expect(html).not.toContain("Editable program"); expect(html).not.toContain("Plan lock");
});
it("D7: a genuinely absent program can still be configured", async () => {
  expect(renderToStaticMarkup(await LoyaltyPage())).toContain("Editable program");
});
