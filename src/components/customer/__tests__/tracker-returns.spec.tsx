// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate, type Locale } from "@/lib/i18n";
const state = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => translate(messagesFor(state.locale), key) }));
import TrackerBody from "../TrackerBody";
import type { TrackedOrder } from "@/lib/order-tracking";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it.each(["en", "es"] as const)("shows the original paid amount, returned money and money still to return in %s", async locale => {
  state.locale = locale;
  const order: TrackedOrder = { id: "sale", restaurant_id: "r1", table_id: null, table_label: null, items: [], total: 30, paid: true, currency: "MXN", status: "completed",
    returnSummary: { paid: 80, returned: 40, pending: 10 } };
  await act(async () => root.render(<TrackerBody order={order} onBack={vi.fn()} />));
  const rows = [...host.querySelectorAll(".tt-total")].map(row => row.textContent);
  expect(rows).toEqual([`${locale === "en" ? "Total paid" : "Total pagado"}MX$80.00`,
    `${locale === "en" ? "Returned" : "Devuelto"}MX$40.00`,
    `${locale === "en" ? "Still to return" : "Pendiente por devolver"}MX$10.00`]);
});
