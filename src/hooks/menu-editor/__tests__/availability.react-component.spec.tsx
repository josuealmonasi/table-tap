// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { begin, dish, mocks, mount, reset, type Harness } from "./availability-harness.react-component";
let h: Harness;
beforeEach(async () => { reset(); h = await mount(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { await h.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["dish", "extra"])("patches the confirmed %s without a full-menu read", async id => {
  const row = dish(id, { ...mocks.rows.find(row => row.id === id), available: false, stock: 3 });
  mocks.write.mockResolvedValueOnce({ data: [row], error: null });
  await act(async () => h.editor.setAvailability(id, false));
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect([...h.editor.products, ...h.editor.addons].find(row => row.id === id)).toEqual(row);
  expect(mocks.sent[0]).toMatchObject({ id, select: "*", filters: [["id", id], ["restaurant_id", "r1"]] });
});
it("keeps the database's stock and actual availability rather than assuming the requested switch won", async () => {
  const row = Object.assign(dish("dish", { available: false, stock: 0 }), { stock_auto_off: true });
  mocks.write.mockResolvedValueOnce({ data: [row], error: null });
  await act(async () => h.editor.setAvailability("dish", true));
  expect(h.editor.products[0]).toEqual(row); expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("copies the confirmed availability from the latest snapshot immediately afterwards", async () => {
  await act(async () => h.editor.setAvailability("dish", false));
  await act(async () => { await h.editor.duplicateProduct("dish"); });
  expect(mocks.inserted[0]).toMatchObject({ available: false, name: "dish copy" });
});
it.each(["zero rows", "refused", "lost response"])("reconciles %s by reading saved state and reporting the failure", async failure => {
  if (failure === "lost response") mocks.write.mockRejectedValueOnce(new Error("connection lost"));
  else mocks.write.mockResolvedValueOnce({ data: [], error: failure === "refused" ? { message: "refused" } : null });
  await act(async () => h.editor.setAvailability("dish", false));
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(h.editor.products[0].available).toBe(true);
  expect(mocks.toast).toHaveBeenCalledWith("write.updateAvailability", "error");
});
it.each(["menu_id", "category_id", "sort_order", "is_addon"])("reloads when the saved row changed its %s grouping", async field => {
  const row = { ...dish(), [field]: field === "sort_order" ? 9 : field === "is_addon" ? true : "changed", available: false };
  mocks.write.mockResolvedValueOnce({ data: [row], error: null });
  await act(async () => h.editor.setAvailability("dish", false));
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("keeps editing blocked when a failed save's reconciliation also fails", async () => {
  mocks.write.mockRejectedValueOnce(new Error("lost")); mocks.read.mockRejectedValueOnce(new Error("offline"));
  await act(async () => h.editor.setAvailability("dish", false));
  expect(h.editor.loadFailed).toBe(true);
  await act(async () => h.editor.setAvailability("extra", false));
  expect(mocks.sent).toHaveLength(1);
});
it("does not send a queued save before the initial complete menu read", async () => {
  await h.close(); mocks.read.mockRejectedValueOnce(new Error("offline")); h = await mount();
  const save = await begin(h); await act(async () => save.done);
  expect(mocks.sent).toHaveLength(0);
});
