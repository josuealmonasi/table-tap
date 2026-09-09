import { orderCode, type OrderLineItem } from "@/lib/types";

/**
 * The ticket the kitchen printer prints.
 *
 * Plain text on purpose. Every CloudPRNT printer renders `text/plain` with its
 * own default font and cuts at the end, so this is the one format that needs
 * no driver, no conversion and no guessing about a vendor's markup dialect.
 * It is also the format a human can read in a test without a printer, which
 * is why the tests below assert against strings rather than bytes.
 *
 * A kitchen ticket is NOT a receipt. It carries no money at all — a cook does
 * not need the total and should not be reading it off the paper while food is
 * waiting. What it does carry, loudly, is what to make, how many, and what
 * somebody asked to be different about it.
 */

/** Characters per line at 80mm in the printer's default font. */
export const TICKET_COLUMNS = 48;

export interface TicketOrder {
  id: string;
  items: OrderLineItem[] | null;
  note?: string | null;
  table_label?: string | null;
  customer_name?: string | null;
  created_at: string;
}

const rule = (ch = "-") => ch.repeat(TICKET_COLUMNS);

/** Centred, and wrapped first so a long restaurant name still fits the roll. */
function centre(text: string): string[] {
  return wrap(text).map(line => {
    const pad = Math.max(0, Math.floor((TICKET_COLUMNS - line.length) / 2));
    return " ".repeat(pad) + line;
  });
}

/**
 * Break a line at spaces so nothing is lost off the edge of the paper.
 *
 * A thermal printer truncates rather than wraps, and the character that gets
 * cut is always at the end — which is where "sin cebolla" lives. Continuation
 * lines are indented so a wrapped modifier still reads as part of its dish.
 */
export function wrap(text: string, indent = 0): string[] {
  const width = TICKET_COLUMNS - indent;
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    // A single word longer than the paper is hard-split; better a broken word
    // than a silently missing one.
    if (word.length > width) {
      if (line) { out.push(line); line = ""; }
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      continue;
    }
    if (line.length + (line ? 1 : 0) + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line += (line ? " " : "") + word;
    }
  }
  if (line) out.push(line);
  // The indent belongs to every line, not just the ones after a break. It is
  // applied here rather than written into `text` because the split above eats
  // leading whitespace, which is how the first line of every modifier came out
  // flush against the dish above it.
  return out.map(l => " ".repeat(indent) + l);
}

/** The chosen options on a line, as the kitchen board writes them. */
export function modsOf(item: { mods?: Record<string, string | string[]> }): string {
  return Object.values(item.mods ?? {})
    .map(v => (Array.isArray(v) ? v.join(", ") : v))
    .filter(Boolean)
    .join(" · ");
}

export function kitchenTicket(
  order: TicketOrder,
  place: { name: string; timeZone: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const when = new Intl.DateTimeFormat("es-MX", {
    timeZone: place.timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(order.created_at));

  const out: string[] = [];
  out.push(...centre(place.name));
  out.push("");
  out.push(...centre(orderCode(order.id)));
  out.push("");

  // Where it goes, said once and near the top: a runner reads this line and
  // nothing else when they pick the plate up.
  const where = order.table_label
    ? t("ticket.table", { label: order.table_label })
    : order.customer_name
      ? t("ticket.counterFor", { name: order.customer_name })
      : t("ticket.counter");
  out.push(...wrap(where));
  out.push(when);
  out.push(rule("="));

  // What the kitchen has to make, and what the cashier already put in a bag.
  // A bottled drink on a ticket is noise a cook has to read past; leaving it
  // off entirely is worse, because the runner then hands over the burger and
  // the customer walks away without the water they paid for. So: made above
  // the line, handed over below it.
  const all = order.items ?? [];
  const toMake = all.filter(i => !i.skipsKitchen);
  const handedOver = all.filter(i => i.skipsKitchen);

  for (const item of toMake) {
    out.push(...wrap(`${item.qty} x ${item.name}`));
    const mods = modsOf(item);
    if (mods) out.push(...wrap(mods, 3));

    if (item.components?.length) {
      // A bundle is several plates sold as one line, so the ticket lists the
      // plates. Its extras are NOT printed here: they are copied onto the
      // parent line for pricing, and printing both would tell the kitchen to
      // add the same cheese twice.
      for (const part of item.components) {
        out.push(...wrap(`- ${part.qty} x ${part.name}`, 3));
        const partMods = modsOf(part);
        if (partMods) out.push(...wrap(partMods, 5));
        for (const extra of part.extras ?? []) out.push(...wrap(`+ ${extra.name}`, 5));
      }
    } else {
      for (const extra of item.extras ?? []) out.push(...wrap(`+ ${extra.name}`, 3));
    }

    // The thing somebody actually asked for. Marked, because a cook scanning
    // a ticket is looking for exactly this and everything else is routine.
    if (item.notes) out.push(...wrap(`>> ${item.notes}`, 3));
    out.push("");
  }

  if (handedOver.length > 0) {
    out.push(rule());
    out.push(...wrap(t("ticket.handedOver")));
    for (const item of handedOver) out.push(...wrap(`${item.qty} x ${item.name}`));
    out.push("");
  }

  if (order.note) {
    out.push(rule());
    out.push(...wrap(`${t("ticket.note")}: ${order.note}`));
  }

  out.push(rule("="));
  out.push("");
  // Thermal heads tear a few millimetres above the last printed line, so the
  // ticket ends with paper to spare rather than with its own last word.
  return out.join("\n") + "\n\n\n";
}
