import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { pendingHarness } from "./pending-ui-harness";

const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, fetch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string) => translate(messagesFor("en"), k) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
import CashMovementDialog from "@/components/dashboard/cash/CashMovementDialog";

beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("fetch", state.fetch);
  state.ui = pendingHarness(); state.fetch.mockReset().mockResolvedValue(Response.json({ id: "saved" }));
});
const body = (at = 0) => JSON.parse(state.fetch.mock.calls[at][1].body);
const dialog = (kind: "withdrawal" | "opening" | null) =>
  <CashMovementDialog kind={kind} currency="MXN" shiftId="shift" onClose={vi.fn()} onSaved={vi.fn()} />;

it.each(["other", "tips"])("submits the selected withdrawal purpose %s", async purpose => {
  state.ui.render(() => dialog("withdrawal"));
  expect(state.ui.all("select")[0].props.value).toBe("other");
  expect(state.ui.text()).toContain("Other withdrawal");
  expect(state.ui.text()).toContain("Tips paid out");
  state.ui.change(state.ui.all("input")[0], "25");
  if (purpose === "tips") state.ui.change(state.ui.all("select")[0], "tips");
  await state.ui.submit();
  expect(state.fetch.mock.calls[0][0]).toBe("/api/cash-drawer");
  expect(body()).toMatchObject({ kind: "withdrawal", amount: "25", purpose, shiftId: "shift" });
  expect(body().ref).toBeTypeOf("string");
});
it("keeps a lost reply's purpose frozen when reopened and retries the exact body", async () => {
  let kind: "withdrawal" | null = "withdrawal";
  state.fetch.mockRejectedValueOnce(new Error("lost reply"));
  state.ui.render(() => dialog(kind));
  state.ui.change(state.ui.all("input")[0], "25");
  state.ui.change(state.ui.all("select")[0], "tips");
  await state.ui.submit();
  kind = null; state.ui.render(); kind = "withdrawal"; state.ui.render();
  expect(state.ui.all("select")[0].props.value).toBe("tips");
  expect(state.ui.all("select")[0].disabled).toBe(true);
  state.ui.change(state.ui.all("select")[0], "other");
  await state.ui.submit();
  expect(body(1)).toEqual(body());
  kind = null; state.ui.render(); kind = "withdrawal"; state.ui.render();
  expect(state.ui.all("select")[0].props.value).toBe("other");
});
it("opens fresh with other after an unsent tips withdrawal is dismissed", () => {
  let kind: "withdrawal" | null = "withdrawal";
  state.ui.render(() => dialog(kind)); state.ui.change(state.ui.all("select")[0], "tips");
  kind = null; state.ui.render(); kind = "withdrawal"; state.ui.render();
  expect(state.ui.all("select")[0].props.value).toBe("other");
});
it("keeps drawer opening separate from withdrawal purposes", async () => {
  state.ui.render(() => dialog("opening"));
  expect(state.ui.all("select")).toHaveLength(0);
  state.ui.change(state.ui.all("input")[0], "100"); await state.ui.submit();
  expect(state.fetch.mock.calls[0][0]).toBe("/api/cash-shift");
  expect(body()).toEqual({ action: "open", amount: "100" });
});
