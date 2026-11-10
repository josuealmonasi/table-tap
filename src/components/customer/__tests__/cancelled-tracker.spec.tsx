import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import TrackerBody from "../TrackerBody";
import type { TrackedOrder } from "@/lib/order-tracking";
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
it("L2: renders no remote name when this device has no name saved for the order", () => {
  const html = renderToStaticMarkup(<TrackerBody order={{ id: "o", status: "received", paid: true,
    items: [], currency: "MXN", total: 100, customer_name: "Private diner" } as unknown as TrackedOrder} onBack={vi.fn()} />);
  expect(html).not.toContain("Private diner");
});
it.each([false, true])("A7: a cancelled tracker says cancelled and offers no payment or visit reward (paid=%s)", paid => {
  const html = renderToStaticMarkup(<TrackerBody order={{ id: "o", status: "cancelled", paid,
    items: [], currency: "MXN", total: 100 } as unknown as TrackedOrder} onBack={vi.fn()} />);
  expect(html).toContain("tracker.cancelled");
  for (const text of ["tracker.received", "tracker.wait", "tracker.showToPay", "/api/order-qr", "tracker.totalDue"]) expect(html).not.toContain(text);
});
