import { describe, expect, it } from "vitest";
import { cashAmount, cashNote, drawerFrom, type CashMovement } from "@/lib/cash-drawer";

/**
 * Asked for by a restaurant: "if we start the day with 250 pesos, the close is
 * the opening plus what was sold, and a withdrawal has to be recorded."
 */

const at = (hhmm: string) => `2026-10-10T${hhmm}:00.000Z`;
const move = (kind: CashMovement["kind"], amount: number, time: string, note: string | null = null): CashMovement => ({
  id: `${kind}-${time}`, kind, amount, note, actor_email: "caja@x.dev", created_at: at(time),
});

describe("the cash drawer", () => {
  it("is the opening, plus the cash taken, minus what was taken out", () => {
    const d = drawerFrom([move("opening", 250, "13:00"), move("withdrawal", 300, "18:00", "proveedor")], 1240);
    expect(d).toMatchObject({ opening: 250, openingSet: true, cashSales: 1240, withdrawn: 300, expected: 1190 });
    expect(d.withdrawals.map(w => w.note)).toEqual(["proveedor"]);
  });

  it("counts the latest opening of the day, whatever order the rows come in", () => {
    const d = drawerFrom([move("opening", 300, "14:00"), move("opening", 250, "13:00")], 0);
    expect(d.opening).toBe(300);
  });

  it("says when nobody set an opening, rather than passing 0 off as one", () => {
    const d = drawerFrom([], 80.5);
    expect(d).toMatchObject({ opening: 0, openingSet: false, expected: 80.5 });
    expect(drawerFrom([move("opening", 0, "13:00")], 0).openingSet).toBe(true);
  });

  it("adds money to the cent", () => {
    const d = drawerFrom([move("opening", 0.1, "13:00"), move("withdrawal", 0.2, "15:00")], 0.3);
    expect(d.expected).toBe(0.2);
  });
});

describe("an amount of cash as typed", () => {
  it("reads whole pesos, cents and thousands separators", () => {
    expect(cashAmount("250", false)).toBe(250);
    expect(cashAmount("250.5", false)).toBe(250.5);
    expect(cashAmount(" 1,250.00 ", false)).toBe(1250);
    expect(cashAmount(99.99, true)).toBe(99.99);
  });

  it("refuses what is not one", () => {
    for (const bad of ["", "-5", "2.505", "abc", "1e3", null, undefined, "2000000"]) expect(cashAmount(bad, false)).toBeNull();
  });

  it("allows an empty drawer to start the day, but no withdrawal of nothing", () => {
    expect(cashAmount("0", false)).toBe(0);
    expect(cashAmount("0", true)).toBeNull();
  });

  it("keeps a reason short, and drops an empty one", () => {
    expect(cashNote("  proveedor  ")).toBe("proveedor");
    expect(cashNote("   ")).toBeNull();
    expect(cashNote("x".repeat(200))).toHaveLength(140);
  });
});
