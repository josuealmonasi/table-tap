import { describe, expect, it } from "vitest";
import { orderCode } from "@/lib/types";
import { filterValue, orderCodeRange, tableLabelQuery } from "@/lib/order-code";
import { randomUUID } from "node:crypto";

describe("finding an order by its code", () => {
  it("covers the id the code was made from", () => {
    const id = "1960abcd-1234-4567-89ab-cdef01234567";
    const range = orderCodeRange(orderCode(id))!;
    expect(range.from <= id && id <= range.to).toBe(true);
  });

  it("takes what somebody types off a ticket", () => {
    const forms = ["ORD-1960", "ord-1960", "1960", "ORD1960", " ORD-1960 "];
    const first = orderCodeRange(forms[0]);
    for (const form of forms) expect(orderCodeRange(form)).toEqual(first);
  });

  it("brackets exactly the ids that start with the code", () => {
    const { from, to } = orderCodeRange("1960")!;
    expect(from).toBe("19600000-0000-0000-0000-000000000000");
    expect(to).toBe("1960ffff-ffff-ffff-ffff-ffffffffffff");
    // A neighbouring code must fall outside it.
    expect("1961aaaa-0000-0000-0000-000000000000" > to).toBe(true);
    expect("195fffff-ffff-ffff-ffff-ffffffffffff" < from).toBe(true);
  });

  it("narrows as more of the code is typed", () => {
    const short = orderCodeRange("ORD-19")!;
    const long = orderCodeRange("ORD-1960")!;
    expect(short.from <= long.from && long.to <= short.to).toBe(true);
  });

  it("refuses anything that isn't a code", () => {
    // A table name or a dish is searched for another way.
    expect(orderCodeRange("Mesa 6")).toBeNull();
    expect(orderCodeRange("Mochi")).toBeNull();
    expect(orderCodeRange("")).toBeNull();
    expect(orderCodeRange("ORD-")).toBeNull();
    // Longer than the first uuid block is not a code either.
    expect(orderCodeRange("1960abcdef")).toBeNull();
  });

  it("treats a bare short number as a table, not the start of a code", () => {
    // Somebody typing 6 means table 6. Codes are four characters, and a
    // shorter search only counts as one when it is spelled out.
    expect(orderCodeRange("6")).toBeNull();
    expect(orderCodeRange("12")).toBeNull();
    expect(orderCodeRange("ORD-6")).not.toBeNull();
  });
});

describe("looking an order up by its table", () => {
  it("drops the word people say in front of the number", () => {
    // Labels are stored as "6"; nobody types it that way.
    expect(tableLabelQuery("Mesa 6")).toBe("6");
    expect(tableLabelQuery("mesa 6")).toBe("6");
    expect(tableLabelQuery("Table 6")).toBe("6");
  });

  it("leaves a label that is already one alone", () => {
    expect(tableLabelQuery("6")).toBe("6");
    expect(tableLabelQuery(" Patio 3 ")).toBe("Patio 3");
  });

  it("keeps a name that merely starts with those letters", () => {
    // "Mesanine" is a room, not "mesa" plus a number.
    expect(tableLabelQuery("Mesanine")).toBe("Mesanine");
  });
});

/**
 * The two halves, asserted against each other rather than one id at a time.
 *
 * `orderCode` writes the code on the ticket and `orderCodeRange` reads it back
 * into the ids it covers. They live in different files, and a cashier types
 * what the customer reads off their phone — a search that cannot find it sends
 * somebody to look through the pass by hand.
 */
describe("a code finds the order it names, for any order", () => {
  it("round-trips twenty thousand ids", () => {
    const misses: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const id = randomUUID();
      const range = orderCodeRange(orderCode(id));
      if (!range) {
        misses.push(`${id} → ${orderCode(id)} → not recognised as a code`);
      } else if (!(id >= range.from && id <= range.to)) {
        misses.push(`${id} → ${orderCode(id)} → [${range.from}, ${range.to}]`);
      }
    }
    expect(misses.slice(0, 3)).toEqual([]);
  });
});

/**
 * `or()` takes ONE raw string and splits it on commas, so a diner called
 * "Perez, Juan" would not merely fail to be found — the half after the comma
 * would be read as another condition.
 */
describe("a search term cannot become a filter", () => {
  it("quotes it, and escapes the quote and the backslash", () => {
    expect(filterValue("Perez, Juan")).toBe('"Perez, Juan"');
    expect(filterValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(filterValue("back\\slash")).toBe('"back\\\\slash"');
  });

  it("leaves an injected condition inside the quotes, where it is just text", () => {
    const evil = "x,customer_name.not.is.null";
    const wrapped = filterValue(evil);
    expect(wrapped.startsWith('"') && wrapped.endsWith('"')).toBe(true);
    expect(wrapped.slice(1, -1)).toBe(evil);
  });
});
