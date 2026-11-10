import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/lib/refunds/operations", () => ({}));
vi.mock("../ManualReturnAttribution", () => ({ default: () => null }));
const { default: OrderRefunds } = await import("../OrderRefunds");
beforeEach(() => { vi.stubGlobal("React", React); });

const row = (id: string, order: string, table: string) => ({ id, adjustment_id: `adj-${id}`, source: "cash" as const, amount: 100, tip: 0,
  currency: "MXN", status: "pending" as const, original_collector: "cashier@x", created_at: "2026-11-09T12:00:00Z",
  order_id: order, table_label: table, kind: "return" as const });

it("tells two MX$100 cash returns apart by order and table (B5)", () => {
  const html = renderToStaticMarkup(<OrderRefunds refunds={[
    row("1", "aaaaaaaa-0000-4000-8000-000000000001", "Mesa 3"),
    row("2", "bbbbbbbb-0000-4000-8000-000000000002", "Mesa 7"),
  ]} />);
  expect(html).toContain("Mesa 3"); expect(html).toContain("Mesa 7");
  expect(html).toMatch(/ORD-AAAA/i); expect(html).toMatch(/ORD-BBBB/i);
  expect(html).toContain("returns.kindReturn");
});
