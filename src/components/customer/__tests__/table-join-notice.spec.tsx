import React from "react";
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { translate } from "@/lib/i18n";
vi.stubGlobal("React", React);
const state = vi.hoisted(() => ({ spanish: true }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(state.spanish ? es : en, key, vars) }));
import TableJoinNotice from "../table-join-notice";

it.each([true, false])("shows waiting, rejection and the phone decision in both languages (Spanish: %s)", spanish => {
  state.spanish = spanish;
  const copy = spanish ? es : en;
  const pending = renderToStaticMarkup(<TableJoinNotice restaurantId="r" error={false} refresh={() => {}}
    state={{ status: "pending", diner: "abcdef12", sessionId: "s", pass: "" }} pending={[]} />);
  expect(pending).toContain(copy.join.waiting);
  expect(pending).toContain(copy.join.explain);
  expect(pending).toContain("ABCDEF");
  const rejected = renderToStaticMarkup(<TableJoinNotice restaurantId="r" error={false} refresh={() => {}}
    state={{ status: "rejected", diner: "abcdef12", sessionId: "s", pass: "" }} pending={[]} />);
  expect(rejected).toContain(copy.join.rejected);
  expect(rejected).toContain(copy.join.rejectedHelp);
  const member = renderToStaticMarkup(<TableJoinNotice restaurantId="r" error={false} refresh={() => {}}
    state={{ status: "approved", diner: "member", sessionId: "s", pass: "" }}
    pending={[{ id: "abcdef12", tableId: "t", tableLabel: "7", createdAt: "2026-10-21" }]} />);
  expect(member).toContain(copy.join.ask);
  expect(member).toContain(copy.join.approve);
  expect(member).toContain(copy.join.reject);
});
