import { round2 } from "@/lib/money";
import { cashAmount } from "@/lib/cash-drawer";
import type { ComboComponent, OrderExtra, OrderLineItem } from "@/lib/types";

/**
 * A sale the till rang without a connection, as it arrives once one returns.
 *
 * The money was taken when it happened, so the server records it as it was
 * taken: at that time, for that total. What the till worked out is checked
 * for shape here — a time in the past and not too long ago, figures that add
 * up — and what today's menu prices it at is compared by the caller.
 *
 * Pure.
 */

/** A sale older than this needs manager review; its collected money is kept. */
export const OFFLINE_MAX_AGE_DAYS = 30;
/** A device clock a little ahead of ours is a clock, not a sale from the future. */
const CLOCK_SKEW_MS = 5 * 60_000;

/** What the till charged, from its own copy of the menu. */
export interface OfflineCharge {
  at: string;
  subtotal: number;
  serviceFee: number;
  tip: number;
  discount: number;
  total: number;
}

export function offlineCharge(raw: unknown, now = Date.now(), recovery = false): OfflineCharge | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  if (!Number.isFinite(at) || at > now + CLOCK_SKEW_MS || (!recovery && now - at > OFFLINE_MAX_AGE_DAYS * 86_400_000) || at < Date.UTC(2000, 0, 1)) return null;
  const money = (v: unknown) => cashAmount(typeof v === "number" ? round2(v) : v, false);
  const subtotal = money(r.subtotal);
  const serviceFee = money(r.serviceFee);
  const tip = money(r.tip);
  const discount = money(r.discount);
  const total = money(r.total);
  if (subtotal === null || serviceFee === null || tip === null || discount === null || total === null) return null;
  // The subtotal is already after the discounts; the service charge and the
  // tip go on top of it. A total that is not those three is not a charge.
  if (Math.abs(round2(subtotal + serviceFee + tip) - total) > 0.01) return null;
  return { at: new Date(at).toISOString(), subtotal, serviceFee, tip, discount, total };
}

/** What was collected less what today's menu prices it at; null when it could not be priced. */
export function offlineDrift(collected: number, serverTotal: number | null): number | null {
  return serverTotal === null ? null : round2(collected - serverTotal);
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const price = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? round2(n) : 0;
};

function offlineMods(raw: unknown): OrderLineItem["mods"] {
  const mods: Record<string, string | string[]> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === "string") mods[k.slice(0, 80)] = v.slice(0, 80);
      else if (Array.isArray(v)) mods[k.slice(0, 80)] = v.filter((x): x is string => typeof x === "string").slice(0, 20).map(x => x.slice(0, 80));
    }
  }
  return mods;
}

/**
 * The till's own lines, kept as the record of a sale whose dishes the menu no
 * longer has. Names and prices as the till had them, bounded; nothing in them
 * moves money, which is the collected total.
 */
export function offlineLines(items: unknown): OrderLineItem[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).flatMap((raw): OrderLineItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const l = raw as Record<string, unknown>;
    const qty = Math.trunc(Number(l.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) return [];
    const mods = offlineMods(l.mods);
    const extras: OrderExtra[] = Array.isArray(l.extras)
      ? (l.extras as Record<string, unknown>[]).slice(0, 20).map(e => ({
          id: text(e?.id, 64), name: text(e?.name, 80), emoji: text(e?.emoji, 8), price: price(e?.price),
        }))
      : [];
    // A combo keeps its parts: they are what the kitchen made and what stock
    // gives up, and the promotion that priced it may be gone by the time the
    // sale is sent.
    const components: ComboComponent[] = Array.isArray(l.components)
      ? (l.components as Record<string, unknown>[]).slice(0, 20).flatMap(c => {
          const n = Math.trunc(Number(c?.qty));
          const itemId = text(c?.itemId, 64);
          return itemId && Number.isFinite(n) && n >= 1 && n <= 99
            ? [{ itemId, name: text(c?.name, 80) || "—", emoji: text(c?.emoji, 8), qty: n, mods: offlineMods(c?.mods) }]
            : [];
        })
      : [];
    const comboId = text(l.comboId, 64);
    const discountPct = Number(l.discountPct);
    return [{
      itemId: text(l.itemId, 64), name: text(l.name, 80) || "—", emoji: text(l.emoji, 8),
      price: price(l.price), qty, mods, extras,
      ...(typeof l.note === "string" ? { note: text(l.note, 150) } : {}),
      ...(comboId && components.length > 0 ? { comboId, components } : {}),
      ...(Number.isFinite(discountPct) && discountPct > 0 && discountPct <= 100 ? { discountPct } : {}),
    }];
  });
}
