import type { Order, OrderStatus } from "@/lib/types";
import type { KitchenLine } from "@/lib/kitchen-ticket";

/**
 * Where an order's lines are made, and how each station sees the order.
 *
 * Asked for by a café: "route drinks to the barista and food to the kitchen".
 * One order holds both, so the order is not split — the bill would split with
 * it. Each line carries its station (copied from its section when the order is
 * written); each station sees and finishes its own lines; the order is ready
 * when every station it needs has finished (`mark_station_ready`).
 *
 * Pure.
 */

export type Station = "kitchen" | "bar";
export const STATIONS: Station[] = ["kitchen", "bar"];

export const stationOf = (line: Pick<KitchenLine, "station">): Station => (line.station === "bar" ? "bar" : "kitchen");

/** The stations an order needs: those of its lines that are made at all. */
export function stationsOf(order: { items: KitchenLine[] }): Station[] {
  const needed = new Set<Station>();
  for (const line of order.items ?? []) if (!line.skipsKitchen) needed.add(stationOf(line));
  return STATIONS.filter(s => needed.has(s));
}

/** Whether a station has anything to make in this order. All of them, with no station chosen. */
export const inStation = (order: { items: KitchenLine[] }, station: Station | null): boolean =>
  station === null || stationsOf(order).includes(station);

/** The lines a station makes; every line when no station is chosen. */
export const linesAt = (order: { items: KitchenLine[] }, station: Station | null): KitchenLine[] =>
  station === null ? order.items : order.items.filter(l => !l.skipsKitchen && stationOf(l) === station);

/** Whether this station has finished its part of the order. */
export const stationDone = (order: Pick<Order, "stations_ready">, station: Station): boolean =>
  (order.stations_ready ?? []).includes(station);

/**
 * The column a station sees the order in: once its own part is done, it is
 * ready as far as that station is concerned, whatever the others are doing.
 */
export function viewStatus(order: Pick<Order, "status" | "stations_ready">, station: Station | null): OrderStatus {
  if (station && stationDone(order, station) && (order.status === "received" || order.status === "preparing")) return "ready";
  return order.status;
}
