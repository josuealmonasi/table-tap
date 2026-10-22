import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { event, field, nodes, resetHooks, state } from "./s23-test-helpers";
import type { Coupon } from "@/hooks/useCoupons";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), confirm: vi.fn(), auth: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  ...await import("./s23-test-helpers").then(h => ({ useState: h.useState, useRef: h.useRef })),
  useCallback: (fn: unknown) => fn, useEffect: () => {}, useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "es" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { resetPasswordForEmail: mocks.auth } }) }));
vi.mock("@/hooks/useDirtyClose", () => ({ useDirtyClose: (_dirty: boolean, close: () => void) => close }));
vi.mock("@/hooks/useCouponOptions", () => ({ useCouponOptions: () => [] }));
import CouponForm from "@/components/dashboard/promotions/CouponForm";
import ComboForm from "@/components/dashboard/promotions/ComboForm";
import QuantityForm from "@/components/dashboard/promotions/QuantityForm";
import TableRow from "@/components/dashboard/tables/TableRow";
import TipPicker from "@/components/customer/TipPicker";
import RateDishesSheet from "@/components/customer/RateDishesSheet";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import RewardsLookup from "@/components/rewards/RewardsLookup";
import BillApprovals from "@/components/dashboard/BillApprovals";
import BillDiscountDialog from "@/components/dashboard/BillDiscountDialog";
import WriteOffDialog from "@/components/dashboard/WriteOffDialog";
import PosAsk from "@/components/dashboard/pos/PosAsk";

const coupon = { id: "c", code: "ABCD-1234", kind: "percent", value: 20, min_subtotal: 0,
  max_uses: null, starts_at: "2026-10-22T18:00:00Z", ends_at: null } as Coupon;
const close = vi.fn();
beforeEach(() => {
  vi.stubGlobal("React", React); state.values = []; state.refs = []; resetHooks(); vi.clearAllMocks();
  vi.stubGlobal("window", { location: { origin: "http://test" } });
  vi.stubGlobal("fetch", vi.fn()); mocks.confirm.mockResolvedValue(false);
});
it("K13: rejected combo and quantity saves retain their drafts", async () => {
  for (const Form of [ComboForm, QuantityForm]) {
    state.values = []; state.refs = []; resetHooks();
    const props = { products: [], categories: [], currency: "MXN", saving: false, onSubmit: vi.fn().mockResolvedValue(false) };
    field(Form(props), "placeholder", Form === ComboForm ? "promos.namePlaceholder" : "promos.dealNamePlaceholder").onChange({ target: { value: "Lunch" } });
    resetHooks(); await field(Form(props), "tag", "form").onSubmit(event);
    resetHooks(); expect(field(Form(props), "value", "Lunch")).toBeDefined();
  }
});
it("K14: editing keeps the printed code read-only and offers no Generate", () => {
  const form = CouponForm({ editing: coupon, currency: "MXN", onClose: close, onSave: vi.fn() });
  expect(field(form, "value", coupon.code).readOnly).toBe(true);
  expect(nodes(form).some(p => p.children === "coupons.generate")).toBe(false);
});
it("K15: a saved 18:00Z coupon opens at noon in the restaurant zone", () => {
  const form = CouponForm({ editing: coupon, currency: "MXN", onClose: close, onSave: vi.fn() });
  expect(nodes(form).some(p => p.type === "datetime-local" && p.value === "2026-10-22T12:00")).toBe(true);
});
it("K17: a refused write-off is visible inside the active write-off dialog", async () => {
  state.values = ["", true, false, null];
  const props = { open: true, bill: { orderIds: ["o"], total: 100, currency: "MXN" }, currency: "MXN", canApprove: true, onClose: close, onApplied: vi.fn() } as unknown as Parameters<typeof BillDiscountDialog>[0];
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Refused" }), { status: 409 }));
  let dialog = field(BillDiscountDialog(props), "tag", WriteOffDialog);
  await (dialog.onSubmit as unknown as (reason: string, note: string) => Promise<void>)("walkout", "");
  resetHooks(); dialog = field(BillDiscountDialog(props), "tag", WriteOffDialog);
  expect(dialog.error).toBe("Refused");
});
it("K17: both approval handlers catch network errors and explain them", async () => {
  const props = { requests: [{ id: "d", amount: 100, code: "CODE", table_label: "1", requested_by: "waiter" }], writeOffs: [{ id: "w", amount: 100, reason: "walkout", note: null, table_label: "1", requested_by: "waiter" }], currency: "MXN" };
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  const buttons = nodes(BillApprovals(props)).filter(p => p.tag === "button");
  for (const button of buttons) await expect(Promise.resolve(button.onClick())).resolves.toBeUndefined();
  expect(mocks.toast).toHaveBeenCalledWith("done.networkError", "error");
});
it("K20: a refused table rename keeps the draft and never confirms", async () => {
  const props = { table: { id: "t", label: "7" }, qr: {}, status: { free: true }, currency: "MXN", onRename: vi.fn().mockResolvedValue(false), onDelete: vi.fn() } as unknown as Parameters<typeof TableRow>[0];
  state.values = [true, "8"];
  await field(TableRow(props), "tag", "form").onSubmit(event);
  resetHooks(); expect(field(TableRow(props), "open", true)).toBeDefined();
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("K21: POS fields cap the name and kitchen note at the shared limits", () => {
  const props = { details: { customerName: "Ana", note: "No onion", setCustomerName: vi.fn(), setNote: vi.fn() } };
  // PosAsk's details hook is supplied by its parent.
  const form = PosAsk({ ...props, d: props.details, open: true, busy: false, currency: "MXN" } as unknown as Parameters<typeof PosAsk>[0]);
  expect(field(form, "value", "Ana").maxLength).toBe(40);
  expect(field(form, "value", "No onion").maxLength).toBe(150);
});
it("K22: a recovery rate limit is not reported as email sent", async () => {
  mocks.auth.mockResolvedValue({ error: { code: "over_email_send_rate_limit", status: 429 } });
  await field(ForgotPasswordForm(), "tag", "form").onSubmit(event);
  resetHooks(); const form = ForgotPasswordForm();
  expect(nodes(form).some(p => p.tag === "form")).toBe(true);
  expect(nodes(form).some(p => p.children === "auth.rateLimited")).toBe(true);
});
it("K24: a custom tip accepts cents", () => {
  const form = TipPicker({ currency: "MXN", tipPct: 0, tipCustom: null, maxTip: 100, onPresetTip: vi.fn(), onCustomTip: vi.fn() });
  expect(field(form, "inputMode", "decimal").step).toBe("0.01");
});
it("K25: refused ratings keep the sheet open and its scores", async () => {
  state.values = [{ "o:p": 5 }, false];
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Try again" }), { status: 503 }));
  const props = { open: true, dishes: [{ orderId: "o", itemId: "p", name: "Taco", emoji: "🌮" }], restaurantId: "r", onClose: close } as Parameters<typeof RateDishesSheet>[0];
  await field(RateDishesSheet(props), "children", "rating.submit").onClick();
  expect(close).not.toHaveBeenCalled(); resetHooks();
  expect(nodes(RateDishesSheet(props)).some(p => p.role === "alert")).toBe(true);
});
it("K25: card removal errors render while the card is still displayed", () => {
  state.values = ["K7QM-3XW9-TB4R", { restaurant: { id: "r" } }, "Removal failed", false, false, null];
  expect(nodes(RewardsLookup({})).some(p => p.role === "alert" && p.children === "Removal failed")).toBe(true);
});

import AddSectionForm from "@/components/dashboard/menu/AddSectionForm";
import AddonsPanel from "@/components/dashboard/menu/AddonsPanel";
import AddonForm from "@/components/dashboard/menu/AddonForm";
import ScheduleDialog from "@/components/dashboard/menu/ScheduleDialog";
import type { ReactNode } from "react";
it("K10: a refused section keeps its name and dialog without a success toast", async () => {
  state.values = ["Desserts"];
  const props = { onAdd: vi.fn().mockResolvedValue(undefined) };
  const root = AddSectionForm(props);
  const renderForm = (root.props as { children: (close: () => void) => ReactNode }).children;
  await field(renderForm(close), "tag", "form").onSubmit(event);
  expect(close).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
  expect(state.values[0]).toBe("Desserts");
});
it("K10: a refused extra edit and schedule save keep their dialogs open", async () => {
  state.values = ["extra", false];
  const props = { addons: [{ id: "extra", name: "Cheese", price: 10 }], currency: "MXN", onAdd: vi.fn(), onUpdate: vi.fn().mockResolvedValue(false), onDelete: vi.fn(), onMove: vi.fn(), onToggleAvailable: vi.fn() } as unknown as Parameters<typeof AddonsPanel>[0];
  const form = nodes(AddonsPanel(props)).find(p => p.tag === AddonForm && p.initial)!;
  await (form.onSubmit as unknown as (input: object) => Promise<void>)({ name: "Cheese", price: 15 });
  expect(state.values[0]).toBe("extra");
  state.values = []; state.refs = []; resetHooks();
  const schedule = ScheduleDialog({ open: true, menuName: "Lunch", onClose: close, onSave: vi.fn().mockResolvedValue(false) });
  await field(schedule, "children", "promos.saveChanges").onClick();
  expect(close).not.toHaveBeenCalled();
});
it("K15: changed coupon wall time submits an explicit offset", async () => {
  const save = vi.fn().mockResolvedValue(null);
  const props = { editing: coupon, currency: "MXN", timeZone: "America/Mexico_City", onClose: close, onSave: save };
  const form = CouponForm(props);
  field(form, "value", "2026-10-22T12:00").onChange({ target: { value: "2026-10-22T13:00" } });
  resetHooks(); await field(CouponForm(props), "tag", "form").onSubmit(event);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ startsAt: "2026-10-22T13:00:00-06:00" }));
});
it("K25: a ratings network failure is retryable, and success still closes", async () => {
  state.values = [{ "o:p": 5 }, false];
  const props = { open: true, dishes: [{ orderId: "o", itemId: "p", name: "Taco", emoji: "🌮" }], restaurantId: "r", onClose: close };
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await field(RateDishesSheet(props), "children", "rating.submit").onClick();
  expect(close).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(new Response("{}")); resetHooks();
  await field(RateDishesSheet(props), "children", "rating.submit").onClick();
  expect(close).toHaveBeenCalledOnce();
});
it("K22: recovery outages keep the form and missing accounts get the same confirmation", async () => {
  for (const outcome of [new Error("offline"), { error: { status: 503 } }]) {
    state.values = []; state.refs = []; resetHooks();
    if (outcome instanceof Error) mocks.auth.mockRejectedValue(outcome); else mocks.auth.mockResolvedValue(outcome);
    await field(ForgotPasswordForm(), "tag", "form").onSubmit(event); resetHooks();
    expect(nodes(ForgotPasswordForm()).some(p => p.children === "auth.unavailable")).toBe(true);
  }
  for (const error of [null, { code: "user_not_found" }]) {
    state.values = []; state.refs = []; resetHooks(); mocks.auth.mockResolvedValue({ error });
    await field(ForgotPasswordForm(), "tag", "form").onSubmit(event); resetHooks();
    expect(nodes(ForgotPasswordForm()).some(p => p.children === "auth.checkEmail")).toBe(true);
  }
});
