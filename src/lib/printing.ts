import { randomBytes } from "node:crypto";
import type { Order, OrderLineItem } from "@/lib/types";

/**
 * La credencial de una impresora.
 *
 * No puede iniciar sesión: lleva este secreto en la URL que alguien teclea una
 * vez en el aparato, así que el token ES la autenticación. 32 bytes, no un
 * uuid — un uuid son 122 bits y medio mundo los trata como adivinables.
 */
export function newPrinterToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lo que ve el endpoint público. Nada que no sea un token nuestro pasa. */
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

/** Un renglón del pedido, con sus opciones, extras y nota debajo. */
function itemLines(item: OrderLineItem): string[] {
  // Envuelto, no recortado: "Ensalada de la casa con aderezo de la…" deja al
  // cocinero adivinando cuál de las dos ensaladas es.
  const lines = wrap(`${item.qty}x ${item.name}`);
  for (const [label, value] of Object.entries(item.mods ?? {})) {
    const shown = Array.isArray(value) ? value.join(", ") : value;
    lines.push(...wrap(`- ${label}: ${shown}`, 3));
  }
  if (item.extras?.length) {
    lines.push(...wrap(`+ ${item.extras.map(e => e.name).join(", ")}`, 3));
  }
  // La nota va en mayúsculas: es lo único de la hoja que alguien tiene que
  // leer entero antes de cocinar, y una alergia perdida entre minúsculas es
  // como se manda un plato que no se puede comer.
  if (item.notes) lines.push(...wrap(`** ${item.notes.toUpperCase()}`, 3));
  return lines;
}

/**
 * La comanda, en texto plano.
 *
 * Sin precios: la cocina no cobra, y un total en la hoja sólo invita a
 * confundirla con la cuenta. Mesa y código grandes arriba, porque es lo que se
 * grita cuando el plato sale.
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
  // Un pedido sin pagar no debe entregarse sin cobrar, y quien está en el pase
  // no tiene la pantalla de cuentas delante.
  if (order.paid === false) {
    lines.push("-".repeat(LINE), "** NO PAGADO — COBRAR AL ENTREGAR");
  }

  lines.push("-".repeat(LINE), "");
  return lines.join("\n");
}
