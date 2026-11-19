import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SplitState } from "@/hooks/useSplit";

vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
import LegacySplitBillCard from "../LegacySplitBillCard";

const split: SplitState = {
  id: "old", status: "locked", shares: 2, amount: 120, proposedBy: "diner", joined: 2,
  mine: { shareNo: 0, amount: 60, paid: false }, outstanding: 120, ownSince: 0, tipPrincipal: null,
};
function render(changes: Partial<SplitState> = {}) {
  return renderToStaticMarkup(<LegacySplitBillCard split={{ ...split, ...changes }} diner="diner" busy={false}
    currency="MXN" tipPct={10} outstanding={120} party={2} cardsEnabled
    propose={vi.fn()} join={vi.fn()} cancel={vi.fn()} onPay={vi.fn()} />);
}
beforeEach(() => { vi.stubGlobal("React", React); });

it("keeps old shares payable and offers an exact tip without percentage presets", () => {
  const html = render();
  expect(html).toContain("split.payShare");
  expect(html).toContain("split.exactTip");
  expect(html).toContain("tip.other");
  expect(html).not.toMatch(/10%|15%|20%/);
});

it("does not offer a tip change after this share has been paid", () => {
  const html = render({ mine: { shareNo: 0, amount: 60, paid: true } });
  expect(html).toContain("split.paid");
  expect(html).not.toContain("tip.other");
});

it("keeps the saved-principal preview and existing percentage choice", () => {
  const html = render({ tipPrincipal: 100 });
  expect(html).toContain("totals.tip");
  expect(html).not.toContain("split.exactTip");
});
