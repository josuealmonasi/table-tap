import { orderCode, type Order, type OrderStatus, type ServiceRequest } from "@/lib/types";

/** Only preparation facts cross the kitchen boundary, including nested extras. */
export interface KitchenLine {
  name: string;
  emoji: string;
  qty: number;
  mods?: Record<string, string | string[]>;
  notes?: string;
  skipsKitchen?: boolean;
  station?: "bar";
  extras?: { name: string; emoji: string }[];
  components?: KitchenLine[];
}

export interface KitchenTicket {
  /** Separate from the diner lookup credential in orders.id. */
  id: string;
  code: string;
  restaurant_id: string;
  table_label: string | null;
  customer_name?: string | null;
  status: OrderStatus;
  stations_ready?: string[];
  items: KitchenLine[];
  note: string | null;
  created_at: string;
}

export type BoardOrder = Order | KitchenTicket;
/** The table UUID opens the public bill, so kitchen calls carry its label only. */
export interface KitchenRequest extends Omit<ServiceRequest, "table_id"> { table_id?: never }
export type BoardRequest = ServiceRequest | KitchenRequest;
export const hasOrderMoney = (order: BoardOrder): order is Order => "total" in order;
export const boardOrderCode = (order: BoardOrder): string => orderCode("code" in order ? order.code : order.id);
