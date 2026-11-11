import type { Standing } from "./standing";

/** Public card details: its bearer code never comes back from a bill read. */
export interface AttachedCard {
  suffix: string;
  progress: number;
  goal: number;
}

export interface ReceiptCard extends AttachedCard {
  /** Server-only identity for de-duplicating a multi-order receipt. Never printed. */
  cardId?: string;
  standing: Standing;
}

export const attachmentErrors = {
  unknown: { key: "loyaltyAttach.unknown", status: 404 },
  off: { key: "loyaltyAttach.off", status: 409 },
  paid: { key: "loyaltyAttach.paid", status: 409 },
  gone: { key: "loyaltyAttach.gone", status: 404 },
} as const;
