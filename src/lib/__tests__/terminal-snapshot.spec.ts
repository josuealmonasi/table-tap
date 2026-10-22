import { expect, it } from "vitest";
import { depositDays, type DepositRecord, type TerminalPayment } from "@/lib/terminal";
const pay = (id: string, amount: number, day: string, recorded_at = `${day}T12:00:00Z`): TerminalPayment => ({ id, amount, tip: 0, created_at: `${day}T10:00:00Z`, recorded_at });
const mark = (day: string, expected: number, payment_ids: string[], return_ids: string[] = []): DepositRecord => ({ sales_day: day, expected, received: expected, note: null, recorded_by: "manager", created_at: `${day}T18:00:00Z`, payment_ids, return_ids, fee_pct: 0 });
it("I3 counts the missing MX$50 even when its transaction timestamp precedes the mark", () => {
  const d = mark("2026-10-20", 100, ["a"]); d.received = 150;
  expect(depositDays([pay("a", 100, d.sales_day), pay("b", 50, d.sales_day)], [d], 0, 1, "UTC", "2026-10-21")[0]).toMatchObject({ expected: 100, late: 50, status: "received" });
});
it("I4 carries Tuesday's later MX$100 return to Wednesday's MX$200 deposit once", () => {
  const returned = { ...pay("return:x", 100, "2026-10-19"), payment_id: "a", returned_at: "2026-10-20T19:00:00Z" };
  const payments = [pay("a", 300, "2026-10-20"), pay("b", 200, "2026-10-21"), returned];
  const tuesday = mark("2026-10-20", 300, ["a"]);
  const days = depositDays(payments, [tuesday], 0, 1, "UTC", "2026-10-21");
  expect(days.find(d => d.day === "2026-10-20")).toMatchObject({ expected: 300, givenBack: 0, status: "received" });
  expect(days.find(d => d.day === "2026-10-21")).toMatchObject({ expected: 100, givenBack: 100 });
  const next = mark("2026-10-21", 100, ["b"], ["return:x"]);
  expect(depositDays([...payments, pay("c", 200, "2026-10-22")], [tuesday, next], 0, 1, "UTC", "2026-10-22").find(d => d.day === "2026-10-22")?.expected).toBe(200);
});
it("I4 keeps a return visible while every sales day is already signed", () => {
  const days = depositDays([pay("a", 300, "2026-10-20"), { ...pay("return:x", 100, "2026-10-19"), payment_id: "a", returned_at: "2026-10-20T19:00:00Z" }], [mark("2026-10-20", 300, ["a"])], 0, 1, "UTC", "2026-10-21");
  expect(days.find(d => !d.deposit)).toMatchObject({ count: 0, givenBack: 100, expected: -100, status: "pending" });
});
it("I7 gives a same-day MX$100 typed void the same zero fee as a legacy void", () => {
  const days = depositDays([pay("a", 100, "2026-10-20"), { ...pay("return:x", 100, "2026-10-20"), payment_id: "a", returned_at: "2026-10-20T17:00:00Z" }], [], 3.5, 1, "UTC", "2026-10-21");
  expect(days.reduce((n, d) => n + d.expected, 0)).toBe(0);
  expect(days.reduce((n, d) => n + d.fee, 0)).toBe(0);
});
it("I7 returns a partial same-day amount net of fee, but a later refund gross", () => {
  const returns = (day: string) => ({ ...pay("return:x", 40, "2026-10-20"), payment_id: "a", returned_at: `${day}T17:00:00Z` });
  expect(depositDays([pay("a", 100, "2026-10-20"), returns("2026-10-20")], [], 3.5, 1, "UTC", "2026-10-21")[0]).toMatchObject({ takings: 60, fee: 2.1, expected: 57.9 });
  expect(depositDays([pay("a", 100, "2026-10-20"), returns("2026-10-21"), pay("b", 200, "2026-10-21")], [], 3.5, 1, "UTC", "2026-10-21")[0]).toMatchObject({ givenBack: 40, expected: 153 });
});

it("I7 carries a same-day return after sign-off net of its original fee", () => {
  const d = mark("2026-10-20", 96.5, ["a"]); d.fee_pct = 3.5;
  const days = depositDays([pay("a", 100, d.sales_day), pay("b", 200, "2026-10-21"),
    { ...pay("return:x", 100, d.sales_day), payment_id: "a", returned_at: "2026-10-20T19:00:00Z" }], [d], 5, 1, "UTC", "2026-10-21");
  expect(days.find(row => row.day === d.sales_day)).toMatchObject({ expected: 96.5, givenBack: 0, status: "received" });
  expect(days[0]).toMatchObject({ givenBack: 96.5, expected: 93.5 });
});
it("keeps same-day voids already in the manifest out of takings and fees", () => {
  const d = mark("2026-10-20", 193, ["a", "b"], ["return:x"]); d.fee_pct = 3.5;
  expect(depositDays([pay("a", 100, d.sales_day), pay("b", 200, d.sales_day),
    { ...pay("return:x", 100, d.sales_day), payment_id: "a", returned_at: "2026-10-20T17:00:00Z" }], [d], 3.5, 1, "UTC", "2026-10-21")[0])
    .toMatchObject({ count: 1, takings: 200, fee: 7, expected: 193, givenBack: 0, status: "received" });
});
