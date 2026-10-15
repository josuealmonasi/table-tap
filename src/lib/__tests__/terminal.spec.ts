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

  it("lists the newest day first", () => {
    const days = depositDays(
      [pay(1, 0, "2026-10-13T15:00:00Z"), pay(1, 0, "2026-10-15T15:00:00Z"), pay(1, 0, "2026-10-14T15:00:00Z")],
      [], 0, 1, TZ, "2026-10-15",
    );
    expect(days.map(d => d.day)).toEqual(["2026-10-15", "2026-10-14", "2026-10-13"]);
  });
});
