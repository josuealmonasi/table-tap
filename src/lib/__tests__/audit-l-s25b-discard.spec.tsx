import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { pendingHarness } from "./pending-ui-harness";
const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (value: unknown) => state.ui.useState(value) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
import PendingAttempt from "@/components/ui/PendingAttempt";
beforeEach(() => { vi.stubGlobal("React", React); state.ui = pendingHarness(); });
it("L5 discarding an uncertain attempt needs a deliberate confirmation after checking the books", () => {
  const discard = vi.fn();
  state.ui.render(() => <PendingAttempt message="pending.purchase" onDiscard={discard} />);
  state.ui.all("button").find(node => node.text === "pending.discard")!.props.onClick!();
  state.ui.render();
  expect(discard).not.toHaveBeenCalled();
  expect(state.ui.text()).toContain("pending.discardWarning");
  state.ui.all("button").find(node => node.text === "pending.discardConfirm")!.props.onClick!();
  expect(discard).toHaveBeenCalledOnce();
});
