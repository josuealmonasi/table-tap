// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { dateLocale } from "@/lib/format";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", loadMore: vi.fn(), markAll: vi.fn() }));
const createdAt = "2026-10-29T23:30:00Z";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({
  useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars),
}));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({
  notifications: [{ id: "n1", kind: "low_stock", data: { name: "Soup", stock: 2 }, read_at: null, created_at: "2026-10-29T23:30:00Z" }],
  unread: 99, markRead: vi.fn(), markAllRead: state.markAll, hasMore: true, loadingMore: false,
  loadMore: state.loadMore, loadError: false, timeZone: "Asia/Tokyo",
}) }));
import NotificationsMenu from "@/components/layout/NotificationsMenu";
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals();
});
const click = async (button: Element) => act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
it.each(["en", "es"] as const)("uses the restaurant date and time in %s, even across midnight", async locale => {
  state.locale = locale;
  await act(async () => root.render(<NotificationsMenu enabled />));
  await click(container.querySelector("button")!);
  const expected = new Date(createdAt).toLocaleString(dateLocale(locale), {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo",
  });
  expect(container.querySelector(".tt-notif-when")?.textContent).toBe(expected);
});
it.each(["en", "es"] as const)("offers older entries and marks the shown entries in %s", async locale => {
  state.locale = locale;
  await act(async () => root.render(<NotificationsMenu enabled />));
  await click(container.querySelector("button")!);
  const t = (key: string) => translate(messagesFor(locale), key);
  const buttons = [...container.querySelectorAll("button")];
  await click(buttons.find(button => button.textContent === t("notif.loadOlder"))!);
  await click(buttons.find(button => button.textContent === t("notif.markAllRead"))!);
  expect(state.loadMore).toHaveBeenCalledOnce(); expect(state.markAll).toHaveBeenCalledOnce();
});
