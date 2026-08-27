import { randomBytes } from "node:crypto";
import type { Order, OrderLineItem } from "@/lib/types";

/**
 * A printer's credential.
 *
 * It cannot sign in: it carries this secret in the URL somebody types into the
 * device once, so the token IS the authentication. 32 bytes rather than a uuid
 * — a uuid is 122 bits and half the world treats them as guessable.
 */
export function newPrinterToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the public endpoint sees. Nothing that is not one of our tokens passes. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,64}$/;

const LINE = 42; // caracteres de una hoja de 80 mm

function wrap(text: string, indent = 0): string[] {
  const width = LINE - indent;
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!line.length) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(" ".repeat(indent) + line);
      line = word;
    }
  }
  if (line.length) out.push(" ".repeat(indent) + line);
  return out;
}

/** One line of the order, with its options, extras and note underneath. */
function itemLines(item: OrderLineItem): string[] {
  // Wrapped, not truncated: "House salad with dressing of the…" leaves the cook
  // guessing which of the two salads it is.
  const lines = wrap(`${item.qty}x ${item.name}`);
  for (const [label, value] of Object.entries(item.mods ?? {})) {
    const shown = Array.isArray(value) ? value.join(", ") : value;
    lines.push(...wrap(`- ${label}: ${shown}`, 3));
  }
  if (item.extras?.length) {
    lines.push(...wrap(`+ ${item.extras.map(e => e.name).join(", ")}`, 3));
  }
  // The note goes in capitals: it is the one thing on the sheet somebody has to
  // read in full before cooking, and an allergy lost among lowercase is how a
  // dish nobody can eat gets sent out.
  if (item.notes) lines.push(...wrap(`** ${item.notes.toUpperCase()}`, 3));
  return lines;
}

/**
 * The ticket, in plain text.
 *
 * No prices: the kitchen does not take money, and a total on the sheet only
 * invites confusing it with the bill. Table and code large at the top, because
 * that is what gets shouted when the plate is up.
 */
export function slipFor(order: Order, code: string, now = new Date()): string {
  const hour = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const where = order.table_label ? `MESA ${order.table_label}` : "PARA LLEVAR";

  const lines = [
    where,
    code,
    hour,
    "-".repeat(LINE),
    ...(order.items ?? []).flatMap(itemLines),
  ];

  if (order.note) {
    lines.push("-".repeat(LINE), ...wrap(`NOTA: ${order.note.toUpperCase()}`));
  }
  // An unpaid order must not be handed over uncollected, and whoever is on the
  // pass does not have the bills screen in front of them.
  if (order.paid === false) {
    lines.push("-".repeat(LINE), "** NO PAGADO — COBRAR AL ENTREGAR");
  }

  lines.push("-".repeat(LINE), "");
  return lines.join("\n");
}
