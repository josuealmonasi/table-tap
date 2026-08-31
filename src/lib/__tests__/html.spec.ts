import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/lib/html";

describe("escaping text for a hand-built print document", () => {
  it("neutralises a tag somebody typed into a table label", () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes the ampersand first, so nothing is double-escaped", () => {
    expect(escapeHtml("Fish & Chips")).toBe("Fish &amp; Chips");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes both quote characters, since attributes use either", () => {
    expect(escapeHtml(`He said "hi" and 'bye'`)).toBe(
      "He said &quot;hi&quot; and &#39;bye&#39;",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Mesa 4 · Ana María")).toBe("Mesa 4 · Ana María");
  });
});
