import { describe, expect, it } from "vitest";
import { printableReceipt } from "@/lib/print-document";

const receipt = `<div style="max-width:480px;padding:24px;color:#16211C">
  <h1>El Fogón</h1>
  <p style="color:#6E7A74">ORD-1234</p>
</div>`;

describe("printableReceipt", () => {
  it("asks the driver for a roll, not a sheet of Letter", () => {
    expect(printableReceipt(receipt, "El Fogón")).toContain("size: 80mm auto");
  });

  it("undoes the email's 480px column, which paper does not have", () => {
    expect(printableReceipt(receipt, "x")).toMatch(/max-width:\s*none\s*!important/);
  });

  it("pushes the screen's greys to black — a thermal head has none", () => {
    const html = printableReceipt(receipt, "x");
    expect(html).toContain("#6E7A74");
    expect(html).toMatch(/color:\s*#000\s*!important/);
  });

  it("carries the receipt through untouched", () => {
    // The document that prints and the document that is emailed are the same
    // one; only the page around it differs.
    expect(printableReceipt(receipt, "x")).toContain(receipt);
  });

  it("carries no inline event handler for the policy to refuse", () => {
    // It used to print itself with `<body onload="window.print()">`, which the
    // Content-Security-Policy blocks. `printWhenReady` does it from the
    // opener and waits for the same moment — printing before the stylesheet
    // applies puts an 80mm ticket on a Letter page.
    expect(printableReceipt(receipt, "x")).not.toMatch(/\son[a-z]+=/i);
  });

  it("cannot have markup smuggled through the title", () => {
    const html = printableReceipt(receipt, '</title><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});
