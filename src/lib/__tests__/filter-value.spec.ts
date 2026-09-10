import { describe, expect, it } from "vitest";
import { filterValue } from "@/lib/order-code";

/**
 * `or()` takes ONE raw filter string and splits it on commas.
 *
 * So a search term is not merely data: unquoted, the half of "Perez, Juan"
 * after the comma is read as another condition, and anything shaped like
 * `x,customer_name.not.is.null` is a filter somebody typed into a search box.
 */
describe("a search term inside an or() filter", () => {
  it("is wrapped, so a comma cannot split the filter", () => {
    expect(filterValue("Perez, Juan")).toBe('"Perez, Juan"');
  });

  it("escapes the quote that does the wrapping", () => {
    expect(filterValue('O"Brien')).toBe('"O\\"Brien"');
  });

  it("escapes the backslash that escapes the quote", () => {
    // Without this, a trailing backslash would escape the closing quote and
    // everything after it would be filter syntax again.
    expect(filterValue("back\\slash")).toBe('"back\\\\slash"');
    expect(filterValue('ends\\')).toBe('"ends\\\\"');
  });

  it("leaves an ordinary name alone but for the quotes", () => {
    expect(filterValue("Ana Lopez")).toBe('"Ana Lopez"');
    expect(filterValue("%Ana%")).toBe('"%Ana%"');
  });

  it("carries an injected condition through as text, not as syntax", () => {
    // Proved against a real database: both of these match nothing.
    expect(filterValue("x,customer_name.not.is.null")).toBe('"x,customer_name.not.is.null"');
    expect(filterValue("x),customer_name.not.is.null,(y")).toBe('"x),customer_name.not.is.null,(y"');
  });
});
