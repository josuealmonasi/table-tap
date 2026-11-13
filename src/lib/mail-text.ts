/** Keep paragraph breaks: filtering empty lines made receipts one solid block. */
export function mailText(lines: readonly string[]): string {
  return lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
