import { describe, expect, it } from "vitest";
import { cancelWording } from "@/lib/cancel-wording";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { CancelSummary } from "@/lib/cancel-plan";

const summary = (extra: Partial<CancelSummary>): CancelSummary => ({
  paid: true, refund: 0, cash: 0, terminal: 0, withTable: 0, ...extra,
});
const money = (n: number) => `MX$${n.toFixed(2)}`;
// Keys and their variables, so a test can see which sentence was chosen.
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

describe("the cancel dialog says what will really happen", () => {
  it("promises a refund only for money Stripe will give back", () => {
    const w = cancelWording(summary({ refund: 80 }), money, t);
    expect(w).toEqual({
      message: "orders.refundMsg(MX$80.00)",
      confirmKey: "orders.cancelRefund",
      done: "orders.cancelledRefunded",
    });
  });

  it("never offers a refund for a card taken on the restaurant's own terminal", () => {
    const w = cancelWording(summary({ terminal: 80 }), money, t);
    expect(w.message).toBe("orders.terminalCancelMsg(MX$80.00)");
    expect(w.confirmKey).toBe("orders.cancelHandBack");
    expect(w.message + w.confirmKey + w.done).not.toMatch(/refund/i);
  });

  it("keeps the cash wording for a sale paid only in cash", () => {
    const w = cancelWording(summary({ cash: 80 }), money, t);
    expect(w).toEqual({
      message: "orders.cashCancelMsg(MX$80.00)",
      confirmKey: "orders.cancelCashOrder",
      done: "orders.cancelledCash",
    });
  });

  it("tells a share of a table's bill apart from a refund", () => {
    const w = cancelWording(summary({ withTable: 30 }), money, t);
    expect(w.message).toBe("orders.withTableCancelMsg(MX$30.00)");
    expect(w.done).toBe("orders.cancelledHandBack(MX$30.00)");
  });

  it("says each part of a mixed payment, and what is left for a person to give", () => {
    const w = cancelWording(summary({ refund: 60, cash: 40 }), money, t);
    expect(w.message).toBe("orders.refundMsg(MX$60.00) orders.cashCancelMsg(MX$40.00)");
    expect(w.confirmKey).toBe("orders.cancelHandBack");
    expect(w.done).toBe("orders.cancelledHandBack(MX$40.00)");
  });

  it("just cancels an order nobody paid", () => {
    expect(cancelWording(summary({ paid: false }), money, t)).toEqual({
      message: "orders.unpaidCancelMsg",
      confirmKey: "orders.cancelOrder",
      done: "orders.cancelledToast",
    });
  });

  it("has every sentence it can say in both languages", () => {
    const keys = ["terminalCancelMsg", "withTableCancelMsg", "cancelHandBack", "cancelledHandBack",
      "refundMsg", "cashCancelMsg", "cancelRefund", "cancelCashOrder", "cancelledRefunded", "cancelledCash"];
    for (const lang of [en, es]) {
      for (const k of keys) expect(lang.orders[k as keyof typeof lang.orders], k).toBeTruthy();
    }
    expect(es.orders.terminalCancelMsg).toContain("{amount}");
    expect(es.orders.cancelledHandBack).toContain("{amount}");
  });
});
