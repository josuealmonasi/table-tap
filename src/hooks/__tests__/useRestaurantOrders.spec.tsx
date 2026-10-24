import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Order } from "@/lib/types";

const { callbacks, toast } = vi.hoisted(() => ({ callbacks: [] as (() => Promise<void>)[], toast: vi.fn() }));
vi.mock("react", () => ({
  useEffect: vi.fn(),
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useCallback: (callback: () => Promise<void>) => { callbacks.push(callback); return callback; },
}));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: true, markOffline: vi.fn() }) }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { useRestaurantOrders } = await import("@/hooks/useRestaurantOrders");
let saved: string | null;
const queue = [
  { id: "o1", from: "received", to: "preparing", at: 1 },
  { id: "o1", from: "preparing", to: "ready", at: 2 },
  { id: "o1", from: "ready", to: "completed", at: 3 },
];
beforeEach(() => {
  callbacks.length = 0;
  saved = JSON.stringify(queue);
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", {
    getItem: () => saved,
    setItem: (_key: string, value: string) => { saved = value; },
    removeItem: () => { saved = null; },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("keeps later steps behind a step whose server failed", async () => {
  const send = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 503 });
  vi.stubGlobal("fetch", send);
  useRestaurantOrders("r1", []);
  await callbacks[0]();
  expect(send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(saved!)).toEqual(queue.slice(1));
});
it("keeps the whole path after a dropped connection", async () => {
  const send = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", send);
  useRestaurantOrders("r1", []);
  await callbacks[0]();
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(saved!)).toEqual(queue);
});
it("drops stale steps and still tries the step that starts at the current stage", async () => {
  const send = vi.fn().mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({}) }).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({}) }).mockResolvedValueOnce({ ok: true, status: 200 });
  vi.stubGlobal("fetch", send);
  useRestaurantOrders("r1", []);
  await callbacks[0]();
  expect(send).toHaveBeenCalledTimes(3);
  expect(saved).toBeNull();
  expect(toast).toHaveBeenCalledWith("orders.queuedRefused", "error");
});
it("sends the stage shown by a live tap too", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", send);
  const hook = useRestaurantOrders("r1", [{ id: "o1", status: "ready" } as Order]);
  await hook.updateStatus("o1", "completed");
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ id: "o1", status: "completed", from: "ready" });
});
