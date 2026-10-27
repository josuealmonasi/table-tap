// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Coupon } from "@/hooks/useCoupons";
const state = vi.hoisted(() => ({ coupons: [] as Coupon[] }));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({ coupons: state.coupons, loading: false, reload: vi.fn(), setActive: vi.fn(), remove: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/dashboard/promotions/CouponForm", () => ({ default: () => null }));
vi.mock("@/hooks/useRowMemory", () => ({ useRowMemory: () => 3 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/plan-server", () => ({ getPlan: vi.fn() }));
import CouponsPanel from "@/components/dashboard/promotions/CouponsPanel";
import { couponProblem } from "@/lib/coupon-service";
let host: HTMLDivElement, root: Root;
const now = new Date("2026-10-27T12:00:00Z");
const coupon = (code: string, extra: Partial<Coupon> = {}): Coupon => ({ id: code, code, kind: "percent", value: 10, active: true, starts_at: null, ends_at: null, max_uses: null, uses_count: 0, min_subtotal: 0, staff_only: false, created_at: now.toISOString(), ...extra });
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); vi.setSystemTime(now);
  state.coupons = [coupon("LUNCH"), coupon("OLD", { ends_at: now.toISOString() }), coupon("NEXT", { starts_at: "2026-10-28T12:00:00Z" }), coupon("PAUSED", { active: false })];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<CouponsPanel restaurantId="r" currency="MXN" />)); }
async function filter(value: string) { await act(async () => { const el = host.querySelector("select")!; el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); }); }
const codes = () => [...host.querySelectorAll("code")].map(n => n.textContent);
it("searches codes without case or surrounding whitespace and composes with status filters", async () => {
  await render();
  await act(async () => { const el = host.querySelector('input[type="search"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, " luN "); el.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(codes()).toEqual(["LUNCH"]);
  await filter("expired"); expect(codes()).toEqual([]); expect(host.textContent).toContain("couponSearch.empty");
});
it("matches the server's exact date boundaries, including a start still in the future", async () => {
  await render(); await filter("expired");
  expect(codes()).toEqual(state.coupons.filter(c => c.active && couponProblem(c, 100, now) === "expired").map(c => c.code));
  await filter("paused"); expect(codes()).toEqual(["PAUSED"]);
  await filter("active"); expect(codes()).toEqual(["LUNCH"]);
});
it("moves a coupon out of active when its end arrives while the screen is open", async () => {
  state.coupons = [coupon("ENDING", { ends_at: new Date(now.getTime() + 1000).toISOString() })];
  await render(); await filter("active"); expect(codes()).toEqual(["ENDING"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(codes()).toEqual([]);
});
