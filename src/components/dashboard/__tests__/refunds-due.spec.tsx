import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string>) => vars?.amount ? `${key} ${vars.amount}` : key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
const { confirm } = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => confirm }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useState: () => [null, vi.fn()] }));
vi.stubGlobal("React", React);
import RefundsDue from "../RefundsDue";

describe("the original currency of money owed back", () => {
  const row = { id: "d1", amount: 125.5, table_label: "4", account_name: null, created_at: "2026-10-01", refunded_at: null };
  it("shows a USD charge even when the menu is now in pesos", () => {
    const html = renderToStaticMarkup(<RefundsDue canRefund refunds={[{ ...row, currency: "USD" }]} />);
    expect(html).toContain("$125.50 · USD");
    expect(html).not.toContain("MX$");
  });
  it("shows an older amount as unverified without guessing the menu currency", () => {
    const html = renderToStaticMarkup(<RefundsDue canRefund refunds={[{ ...row, currency: null }]} />);
    expect(html).toContain("125.50 · refunds.currencyUnknown");
    expect(html).not.toContain("MX$");
  });
});

it("keeps a fee retry visible after the customer was paid back", () => {
  const html = renderToStaticMarkup(<RefundsDue canRefund={false} refunds={[{ id: "d1", amount: 125.5,
    currency: "USD", table_label: "4", account_name: null, created_at: "2026-10-01", refunded_at: "2026-10-02" }]} />);
  expect(html).toContain("refunds.feePending");
  expect(html).toContain("refunds.retryFee");
});

it.each(["amount=125.50 currency=unverified why=paid_twice", "amount=125.50 why=paid_twice"])("does not relabel an unverified activity amount: %s", async detail => {
  const { useLogWords } = await import("@/hooks/useLogWords");
  const text = useLogWords("MXN").specifics({ entity: "bill", action: "refunded", detail });
  expect(text).toContain("125.50 · refunds.currencyUnknown");
  expect(text).not.toContain("MX$");
});

it("approves the same original currency displayed on the refund row", async () => {
  const tree = RefundsDue({ canRefund: true, refunds: [{ id: "d1", amount: 125.5, currency: "USD",
    table_label: "4", account_name: null, created_at: "2026-10-01", refunded_at: null }] });
  function findButton(node: React.ReactNode): React.ReactElement<{ onClick: () => Promise<void> }> | undefined {
    if (Array.isArray(node)) return node.map(findButton).find(Boolean);
    if (!React.isValidElement<{ children?: React.ReactNode; onClick: () => Promise<void> }>(node)) return;
    if (node.type === "button") return node;
    return findButton(node.props.children);
  }
  await findButton(tree)!.props.onClick();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "refunds.confirmTitle $125.50 · USD" }));
});
