/**
 * Wraps the receipt for paper.
 *
 * The receipt itself is built once, in `buildReceipt`, and the same HTML goes
 * in the email and on the roll — a printed ticket that disagrees with the
 * emailed one is two documents pretending to be one. What differs is only the
 * medium, so only the medium is described here: an 80mm page, no margins, and
 * the screen's soft greys pushed to black because a thermal head has no grey.
 *
 * `@page { size: 80mm auto }` is what makes a browser hand the driver a roll
 * instead of a sheet of Letter. Chrome honours it when the printer reports a
 * roll width; where it does not, the page still prints, narrower than the
 * paper rather than clipped — which is the failure worth having.
 */
export function printableReceipt(receiptHtml: string, title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title.replace(/[<&]/g, "")}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body > div {
    /* The email centres itself in a 480px column; paper has no such room. */
    max-width: none !important;
    width: auto !important;
    margin: 0 !important;
    padding: 4mm 3mm 10mm !important;
    color: #000 !important;
    font-size: 12px !important;
  }
  /* No grey on a thermal head: it dithers into something faint and speckled. */
  body [style*="color:#6E7A74"], body [style*="color: #6E7A74"] { color: #000 !important; }
  body [style*="border-top"] { border-top-color: #000 !important; }
  h1 { font-size: 15px !important; }
  table { font-size: 12px !important; }
  td { padding: 3px 0 !important; }
  @media print {
    /* Nothing but the ticket: no headers, no URLs, no page numbers. */
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${receiptHtml}
</body>
</html>`;
}
