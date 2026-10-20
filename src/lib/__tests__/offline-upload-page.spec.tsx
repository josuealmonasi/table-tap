import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.stubGlobal("React", React);
const state = vi.hoisted(() => ({ frozen: false, pos: false, role: "cashier" }));
vi.mock("@/lib/membership", () => ({ getMembership: async () => ({ role: state.role, restaurant: { id: "r", currency: "MXN" } }),
  TAKES_COUNTER_ORDERS: (role: string) => ["owner", "manager", "cashier"].includes(role), MANAGES: (role: string) => ["owner", "manager"].includes(role) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ status: state.frozen ? "frozen" : "active", limits: {} }), allPlans: async () => [] }));
vi.mock("@/lib/plan", () => ({ can: () => state.pos, dashboardFrozen: (status: string) => status === "frozen", cheapestWith: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/components/dashboard/plan/PlanLock", () => ({ default: () => <p>Plan lock</p> }));
vi.mock("@/components/dashboard/pos/UploadHeldSales", () => ({ default: () => <p>Upload held sales only</p> }));
vi.mock("@/components/dashboard/pos/PosScreen", () => ({ default: () => <p>New sale</p> }));
vi.mock("@/lib/ordering-data", () => ({ loadOrderingData: async () => { throw new Error("Should not load a new sale"); } }));
vi.mock("@/components/layout/Breadcrumb", () => ({ default: () => null }));
vi.mock("@/components/dashboard/pos/HeldSales", () => ({ default: () => <p>Manager queue</p> }));
const { default: HeldSalesPage } = await import("@/app/dashboard/held-sales/page");
const { default: PosPage } = await import("@/app/dashboard/pos/page");
beforeEach(() => { state.frozen = false; state.pos = false; state.role = "cashier"; });
it("mounts upload-only recovery for a cashier after POS entitlement loss", async () => {
  expect(renderToStaticMarkup(await PosPage())).toContain("Upload held sales only");
});
it("mounts upload-only recovery for a cashier after a freeze", async () => {
  state.frozen = true; state.pos = true;
  expect(renderToStaticMarkup(await PosPage())).toContain("Upload held sales only");
});
it("keeps non-counter staff out of upload recovery", async () => {
  state.role = "kitchen";
  await expect(PosPage()).rejects.toThrow("redirect:/dashboard/orders");
});

it("lets a cashier reach upload through Held Sales without exposing the manager queue", async () => {
  const html = renderToStaticMarkup(await HeldSalesPage());
  expect(html).toContain("Upload held sales only");
  expect(html).not.toContain("Manager queue");
});
it("retains a cashier's Held Sales navigation after a downgrade", async () => {
  const { navItemsFor } = await vi.importActual<typeof import("@/lib/nav")>("@/lib/nav");
  expect(navItemsFor("cashier", () => false).map(i => i.href)).toContain("/dashboard/held-sales");
  for (const role of ["waiter", "kitchen"] as const) expect(navItemsFor(role, () => false).map(i => i.href)).not.toContain("/dashboard/held-sales");
});
