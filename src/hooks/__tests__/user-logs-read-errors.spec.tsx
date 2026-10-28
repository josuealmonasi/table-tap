// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));
vi.mock("@/lib/i18n/context", () => ({
  useT: () => (key: string, values?: { n?: number }) => values?.n === undefined ? key : `${key}:${values.n}`,
  useLocale: () => ({ locale: "en" }),
}));
import { useUserLogs, type UserLog } from "../useUserLogs";
import UserLogs from "@/components/dashboard/staff/UserLogs";

interface Result { data: UserLog[] | null; count: number | null; error: { message: string } | null }
const log: UserLog = {
  id: "log-1", actor_email: "owner@example.com", entity: "settings", action: "updated",
  detail: null, target_role: null, target_email: null, created_at: "2026-10-27T12:00:00Z",
};
const success: Result = { data: [log], count: 11, error: null };
const failed: Result = { data: null, count: null, error: { message: "statement timeout" } };
function queue(result: Result | Promise<Result>) {
  const request = Object.assign(Promise.resolve(result), {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
  });
  from.mockReturnValueOnce(request);
  return request;
}
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useUserLogs>;
function Harness({ restaurantId = "r1", entities = [] }: { restaurantId?: string; entities?: string[] }) {
  latest = useUserLogs(restaurantId, entities);
  return null;
}
async function render(child: React.ReactNode = <UserLogs restaurantId="r1" currency="MXN" />) {
  await act(async () => root.render(child));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  from.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows a failed initial log read with retry instead of no activity", async () => {
  queue(failed); await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("done.networkError");
  expect(container.textContent).not.toContain("dash.logsEmpty");
  queue(success); await click("settle.retry");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain(log.actor_email);
});
it("keeps the last activity rows and count when a page fails and retries that page", async () => {
  queue(success); await render();
  queue(failed); await click("dash.older");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).toContain(log.actor_email);
  expect(container.textContent).toContain("dash.activityCount:11");
  expect(container.textContent).not.toContain("dash.logsEmpty");
  const request = queue({ ...success, data: [{ ...log, actor_email: "next@example.com" }] });
  await click("settle.retry");
  expect(request.range).toHaveBeenCalledWith(10, 19);
  expect(container.textContent).toContain("next@example.com");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("keeps previous rows visible while a replacement page is still loading", async () => {
  queue(success); await render();
  let finish!: (result: Result) => void;
  queue(new Promise<Result>(resolve => { finish = resolve; }));
  await click("dash.older");
  expect(container.textContent).toContain(log.actor_email);
  await act(async () => finish(failed));
});
it("shows no activity only after a successful empty read", async () => {
  queue({ data: [], count: 0, error: null }); await render();
  expect(container.textContent).toContain("dash.logsEmpty");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it.each(["thrown", "rejected"])("handles a %s log request and lets the owner retry", async failure => {
  if (failure === "thrown") from.mockImplementationOnce(() => { throw new TypeError("offline"); });
  else queue(Promise.reject(new TypeError("offline")));
  await render();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  queue(success); await click("settle.retry");
  expect(container.textContent).toContain(log.actor_email);
});
it("never retains another restaurant's activity after a failed read", async () => {
  queue(success); await render();
  queue(failed); await render(<UserLogs restaurantId="r2" currency="USD" />);
  expect(container.textContent).not.toContain(log.actor_email);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it.each([
  ["Perez, Juan", '"%Perez, Juan%"'],
  ["(cash)", '"%(cash)%"'],
  ['A"\\B', '"%A\\"\\\\B%"'],
])("quotes activity searches for %s using the history filter grammar", async (query, value) => {
  vi.useFakeTimers(); queue(success); await render(<Harness entities={["settings"]} />);
  const request = queue(success);
  await act(async () => latest.setQuery(query));
  await act(async () => vi.advanceTimersByTime(250));
  expect(request.or).toHaveBeenCalledWith([
    "actor_email", "entity", "action", "detail", "target_email",
  ].map(column => `${column}.ilike.${value}`).concat("entity.in.(settings)").join(","));
});
it("keeps a failed search distinct from no matches", async () => {
  vi.useFakeTimers(); queue(success); await render(<Harness />);
  queue(failed); await act(async () => latest.setQuery("missing"));
  await act(async () => vi.advanceTimersByTime(250));
  expect(latest.logs).toEqual([log]);
  expect(latest.total).toBe(11);
  expect(latest).toHaveProperty("error", true);
});
it("ignores a late failure from the page replaced by a newer read", async () => {
  queue(success); await render(<Harness />);
  let finish!: (result: Result) => void;
  queue(new Promise<Result>(resolve => { finish = resolve; }));
  await act(async () => latest.setPage(2));
  queue({ ...success, data: [{ ...log, id: "newer" }] });
  await act(async () => latest.setPage(1));
  await act(async () => finish(failed));
  expect(latest.logs[0].id).toBe("newer");
  expect(latest).toHaveProperty("error", false);
  expect(latest.loading).toBe(false);
});
