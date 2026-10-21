import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { duplicateMenuDeep } from "@/lib/menu-duplicate";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
it("J14 copies on the server, using saved fields instead of stale editor state", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ newMenuId: "copy", copyName: "Dinner copy" }) });
  const reportError = vi.fn(() => true);
  const result = await duplicateMenuDeep({ sourceId: "source", reportError });
  expect(result).toEqual({ newMenuId: "copy", copyName: "Dinner copy" });
  expect(fetchMock).toHaveBeenCalledWith("/api/menu/duplicate", expect.objectContaining({
    method: "POST", body: JSON.stringify({ sourceId: "source" }),
  }));
});
it("J14 reports failure without returning a partial copy", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "failed" }) });
  const reportError = vi.fn(() => false);
  await expect(duplicateMenuDeep({ sourceId: "source", reportError })).resolves.toBeUndefined();
  expect(reportError).toHaveBeenCalledWith("write.duplicateMenu", { message: "failed" });
});

it("J14 reports an interrupted request without a success result", async () => {
  fetchMock.mockRejectedValue(new Error("connection lost"));
  const reportError = vi.fn(() => false);
  await expect(duplicateMenuDeep({ sourceId: "source", reportError })).resolves.toBeUndefined();
  expect(reportError).toHaveBeenCalledTimes(1);
});
