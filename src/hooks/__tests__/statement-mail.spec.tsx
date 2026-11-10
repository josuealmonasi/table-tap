// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStatementMail } from "@/hooks/useStatementMail";

let send: ReturnType<typeof useStatementMail>;
let root: Root;
const fetcher = vi.fn<typeof fetch>();
function Probe({ code }: { code: string }) { send = useStatementMail(code); return null; }
const body = (index: number) => JSON.parse(String(fetcher.mock.calls[index][1]?.body));
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset(); root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe code="account-code" />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("retains its reference through a lost reply and a provider failure, then renews after success", async () => {
  fetcher.mockRejectedValueOnce(new TypeError("lost reply"))
    .mockResolvedValueOnce(new Response("{}", { status: 502 }))
    .mockResolvedValue(new Response("{}", { status: 200 }));
  await expect(send("Diner@example.com")).rejects.toThrow("Statement email request failed");
  await send("diner@example.com"); await send("diner@example.com"); await send("diner@example.com");
  expect(body(0).ref).toBeTruthy();
  expect(body(1)).toEqual(body(0)); expect(body(2)).toEqual(body(0));
  expect(body(3).ref).not.toBe(body(0).ref);
});
it("uses a different send for a changed recipient or account", async () => {
  fetcher.mockResolvedValue(new Response("{}", { status: 502 }));
  await send("one@example.com"); await send("two@example.com");
  await act(async () => root.render(<Probe code="other-account" />));
  await send("two@example.com");
  expect(new Set([body(0).ref, body(1).ref, body(2).ref]).size).toBe(3);
});
