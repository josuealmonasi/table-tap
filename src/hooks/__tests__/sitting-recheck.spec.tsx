// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rememberSitting, recallSitting } from "@/lib/table-binding";
import { useSitting, ELSEWHERE_RECHECK_MS, type OpenElsewhere } from "@/hooks/useSitting";

let seen: OpenElsewhere | null = null;
function Probe() { seen = useSitting("r1", "table-2"); return null; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("clears the other-table notice once that bill is paid, without a rescan (A5)", async () => {
  rememberSitting("r1", "sitting-1", "table-1");
  let open = true;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(open ? { open: true, tableLabel: "1", owed: 100 } : { open: false })));
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await act(async () => {});
  expect(seen).toMatchObject({ tableLabel: "1", owed: 100, tableId: "table-1" });
  open = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(ELSEWHERE_RECHECK_MS); });
  await act(async () => {});
  expect(seen).toBeNull();
  expect(recallSitting("r1")).toBeNull();
  await act(async () => root.unmount());
});
