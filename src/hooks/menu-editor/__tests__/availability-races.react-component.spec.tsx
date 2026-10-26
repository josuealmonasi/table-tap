// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MenuData } from "@/lib/menu-data";
import { begin, deferred, dish, mocks, mount, reset, snapshot, type Harness, type Result } from "./availability-harness.react-component";
let h: Harness;
beforeEach(async () => { reset(); h = await mount(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { await h.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const result = (available: boolean, id = "dish"): Result => ({ data: [dish(id, { available })], error: null });

it("serializes rapid clicks across renders while keeping the latest intent visible", async () => {
  const first = deferred<Result>(), second = deferred<Result>();
  mocks.write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const off = await begin(h); await h.render("r1"); const on = await begin(h, "dish", true);
  expect(mocks.sent.map(row => row.available)).toEqual([false]);
  expect(h.editor.products[0].available).toBe(true);
  await act(async () => { first.resolve(result(false)); await off.done; });
  expect(mocks.sent.map(row => row.available)).toEqual([false, true]);
  expect(h.editor.products[0].available).toBe(true);
  await act(async () => { second.resolve(result(true)); await on.done; });
  expect(h.editor.products[0].available).toBe(true); expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("saves different items independently without undoing another item's optimistic switch", async () => {
  const first = deferred<Result>(), second = deferred<Result>();
  mocks.write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = await begin(h), b = await begin(h, "extra"); expect(mocks.sent).toHaveLength(2);
  await act(async () => { second.resolve({ data: [dish("extra", { is_addon: true, available: false })], error: null }); await b.done; });
  expect(h.editor.products[0].available).toBe(false); expect(h.editor.addons[0].available).toBe(false);
  await act(async () => { first.resolve(result(false)); await a.done; });
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("invalidates a full read started before the write answered so it cannot undo the saved row", async () => {
  const write = deferred<Result>(), read = deferred<MenuData>(); const old = snapshot();
  mocks.write.mockReturnValueOnce(write.promise); const save = await begin(h);
  mocks.read.mockReturnValueOnce(read.promise); let reload!: Promise<void>;
  await act(async () => { reload = h.editor.reload(); });
  await act(async () => { write.resolve(result(false)); await save.done; });
  await act(async () => { read.resolve(old); await reload; });
  expect(h.editor.products[0].available).toBe(false); expect(mocks.read).toHaveBeenCalledTimes(3);
});
it("waits for the newest full read before sending the switch", async () => {
  const first = deferred<MenuData>(), second = deferred<MenuData>();
  mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a!: Promise<void>, b!: Promise<void>;
  await act(async () => { a = h.editor.reload(); }); const save = await begin(h);
  await act(async () => { b = h.editor.reload(); first.resolve(snapshot()); await a; });
  expect(mocks.sent).toHaveLength(0);
  await act(async () => { second.resolve(snapshot()); await b; await save.done; });
  expect(mocks.sent).toHaveLength(1); expect(mocks.read).toHaveBeenCalledTimes(3);
  expect(h.editor.products[0].available).toBe(false);
});
it("reconciles a different item's failed save without undoing a successful switch", async () => {
  const first = deferred<Result>(), second = deferred<Result>();
  mocks.write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = await begin(h), b = await begin(h, "extra");
  await act(async () => { first.resolve(result(false)); await a.done; });
  await act(async () => { second.resolve({ data: [], error: null }); await b.done; });
  expect(h.editor.products[0].available).toBe(false); expect(h.editor.addons[0].available).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("keeps a queued click after a lost response and its successful reconciliation", async () => {
  const first = deferred<Result>(); mocks.write.mockReturnValueOnce(first.promise);
  const off = await begin(h), on = await begin(h, "dish", true);
  await act(async () => { first.reject(new Error("response lost")); await off.done; await on.done; });
  expect(mocks.sent.map(row => row.available)).toEqual([false, true]);
  expect(h.editor.products[0].available).toBe(true); expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("drops queued writes if reconciliation fails, then accepts a fresh click after retry", async () => {
  const first = deferred<Result>(); mocks.write.mockReturnValueOnce(first.promise);
  const off = await begin(h), on = await begin(h, "dish", true);
  mocks.read.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { first.reject(new Error("lost")); await off.done; await on.done; });
  expect(h.editor.loadFailed).toBe(true); expect(mocks.sent).toHaveLength(1);
  await act(async () => h.editor.reload()); await act(async () => h.editor.setAvailability("dish", false));
  expect(mocks.sent).toHaveLength(2); expect(h.editor.products[0].available).toBe(false);
});
it("retires the old restaurant's queue and late result without touching the new restaurant", async () => {
  const first = deferred<Result>(); mocks.write.mockReturnValueOnce(first.promise);
  const off = await begin(h), on = await begin(h, "dish", true);
  mocks.rows = [dish("new", { restaurant_id: "r2" })]; await h.render("r2");
  await act(async () => h.editor.setAvailability("new", false));
  await act(async () => { first.resolve(result(false)); await off.done; await on.done; });
  expect(mocks.sent.map(row => row.id)).toEqual(["dish", "new"]);
  expect(mocks.sent[1].filters).toContainEqual(["restaurant_id", "r2"]);
  expect(h.editor.products).toEqual([dish("new", { restaurant_id: "r2", available: false })]);
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.toast).not.toHaveBeenCalled();
});
it("does not send queued work, reload or toast after unmount", async () => {
  const first = deferred<Result>(); mocks.write.mockReturnValueOnce(first.promise);
  const off = await begin(h), on = await begin(h, "dish", true); await h.close();
  await act(async () => { first.resolve(result(false)); await off.done; await on.done; });
  expect(mocks.sent).toHaveLength(1); expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.toast).not.toHaveBeenCalled();
});
