import { describe, expect, it } from "vitest";
import { addBusinessDays, depositDays, localDay } from "@/lib/terminal";

const TZ = "America/Mexico_City";

describe("the business day a deposit lands on", () => {
  it("skips the weekend", () => {
    expect(addBusinessDays("2026-10-15", 1)).toBe("2026-10-16"); // Thursday → Friday
    expect(addBusinessDays("2026-10-16", 1)).toBe("2026-10-19"); // Friday → Monday
    expect(addBusinessDays("2026-10-17", 1)).toBe("2026-10-19"); // Saturday → Monday
    expect(addBusinessDays("2026-10-16", 2)).toBe("2026-10-20");
  });

  it("puts a same-day settlement on a business day", () => {
    expect(addBusinessDays("2026-10-15", 0)).toBe("2026-10-15");
    expect(addBusinessDays("2026-10-18", 0)).toBe("2026-10-19"); // Sunday → Monday
  });

  it("reads the day in the restaurant's own zone", () => {
    // 01:00 UTC on the 16th is still the evening of the 15th in Mexico City.
    expect(localDay("2026-10-16T01:00:00Z", TZ)).toBe("2026-10-15");
  });
});

describe("what the terminal should deposit", () => {
  const pay = (amount: number, tip: number, at: string) => ({ amount, tip, created_at: at });

  it("adds up a day, takes the fee, and dates the deposit", () => {
    const [day] = depositDays(
      [pay(100, 10, "2026-10-15T15:00:00Z"), pay(300, 0, "2026-10-15T20:00:00Z")],
      [], 3.5, 1, TZ, "2026-10-15",
    );
    expect(day).toMatchObject({ day: "2026-10-15", count: 2, takings: 400, tips: 10, fee: 14, expected: 386, expectedOn: "2026-10-16", status: "pending" });
  });

  it("is due on its day and overdue after it", () => {
    const one = [pay(100, 0, "2026-10-15T15:00:00Z")];
    expect(depositDays(one, [], 0, 1, TZ, "2026-10-16")[0].status).toBe("due");
    expect(depositDays(one, [], 0, 1, TZ, "2026-10-19")[0].status).toBe("overdue");
  });

  it("reads a deposit as received, short or over, against what was expected when it was marked", () => {
    const one = [pay(100, 0, "2026-10-15T15:00:00Z")];
    const marked = (received: number) => [{ sales_day: "2026-10-15", expected: 96.5, received, note: null, recorded_by: "x", created_at: "t" }];
    expect(depositDays(one, marked(96.5), 3.5, 1, TZ, "2026-10-20")[0].status).toBe("received");
    expect(depositDays(one, marked(96.2), 3.5, 1, TZ, "2026-10-20")[0].status).toBe("received");
    expect(depositDays(one, marked(90), 3.5, 1, TZ, "2026-10-20")[0].status).toBe("short");
    expect(depositDays(one, marked(120), 3.5, 1, TZ, "2026-10-20")[0].status).toBe("over");
    // A refund after marking does not rewrite the figure that was reconciled.
    expect(depositDays([], marked(96.5), 3.5, 1, TZ, "2026-10-20")[0]).toMatchObject({ expected: 96.5, status: "received", takings: 0 });
  });

  // A cancelled sale is voided on the terminal by a person, as the cancel
  // dialog asks. The deposits used to count it anyway, and read short.
  describe("a sale cancelled and voided on the terminal", () => {
    const voided = (amount: number, at: string, voidedAt: string) => ({ amount, tip: 0, created_at: at, voided_at: voidedAt });

    it("counts nowhere when voided the day it was taken: the bank never pays it", () => {
      const days = depositDays(
        [pay(300, 0, "2026-10-15T15:00:00Z"), voided(100, "2026-10-15T16:00:00Z", "2026-10-15T16:05:00Z")],
        [], 3.5, 1, TZ, "2026-10-15",
      );
      expect(days).toHaveLength(1);
      expect(days[0]).toMatchObject({ count: 1, takings: 300, fee: 10.5, givenBack: 0, expected: 289.5 });
    });

    it("comes out of the deposit of the day it was voided, when voided later", () => {
      const days = depositDays(
        [voided(100, "2026-10-13T15:00:00Z", "2026-10-15T17:00:00Z"), pay(300, 0, "2026-10-15T15:00:00Z")],
        [], 3.5, 1, TZ, "2026-10-15",
      );
      // The bank paid the 13th's sale; the 15th's deposit gives it back.
      expect(days.find(d => d.day === "2026-10-13")).toMatchObject({ count: 1, takings: 100, givenBack: 0, expected: 96.5 });
      expect(days.find(d => d.day === "2026-10-15")).toMatchObject({ count: 1, takings: 300, fee: 10.5, givenBack: 100, expected: 189.5 });
    });

    it("waits for the next day with sales when the day it was voided had none", () => {
      const sales = [voided(100, "2026-10-13T15:00:00Z", "2026-10-14T17:00:00Z")];
      const later = depositDays([...sales, pay(300, 0, "2026-10-15T15:00:00Z")], [], 0, 1, TZ, "2026-10-15");
      expect(later.map(d => d.day)).toEqual(["2026-10-15", "2026-10-13"]);
      expect(later[0]).toMatchObject({ givenBack: 100, expected: 200 });
      // No sale since: it stays on its own day, waiting — never late.
      const none = depositDays(sales, [], 0, 1, TZ, "2026-10-20");
      expect(none.find(d => d.day === "2026-10-14")).toMatchObject({ count: 0, givenBack: 100, status: "pending" });
    });

    it("lists no day before the window, but still takes back a void from it", () => {
      const days = depositDays(
        [voided(100, "2026-10-01T15:00:00Z", "2026-10-15T17:00:00Z"), pay(300, 0, "2026-10-15T15:00:00Z")],
        [], 0, 1, TZ, "2026-10-15", "2026-10-02",
      );
      expect(days.map(d => d.day)).toEqual(["2026-10-15"]);
      expect(days[0]).toMatchObject({ takings: 300, givenBack: 100, expected: 200 });
    });
  });

  it("lists the newest day first", () => {
    const days = depositDays(
      [pay(1, 0, "2026-10-13T15:00:00Z"), pay(1, 0, "2026-10-15T15:00:00Z"), pay(1, 0, "2026-10-14T15:00:00Z")],
      [], 0, 1, TZ, "2026-10-15",
    );
    expect(days.map(d => d.day)).toEqual(["2026-10-15", "2026-10-14", "2026-10-13"]);
  });
});
