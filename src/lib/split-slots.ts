export interface SplitScope { restaurantId: string; tableId: string; sessionId: string }
export interface SplitResumption { slots: number[]; tipCents: number; amountCents: number }
export interface SplitSlot {
  shareNo: number; amountCents: number; feeCents: number; paid: boolean; paying: boolean;
}
export interface SlotSplit {
  id: string; restaurant_id: string; session_id: string; model_version: number; revision: number;
  status: string; proposed_by: string; currency: string; order_ids: string[]; food_principal: number;
}
export interface SplitOutcome {
  outcome: string; split?: string; revision?: number; amount_cents?: number; fee_cents?: number;
  debt_cents?: number; payment?: string; tip_cents?: number;
}
export const splitUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const splitCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647;
export const splitRevision = (value: unknown): value is number => splitCents(value) && Number(value) > 0;
export const splitSelection = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.length <= 20 && new Set(value).size === value.length
  && value.every(n => Number.isInteger(n) && n >= 0 && n < 20);
export const splitScope = <T extends Partial<SplitScope>>(body: T): body is T & SplitScope =>
  splitUuid(body.restaurantId) && splitUuid(body.tableId) && splitUuid(body.sessionId);
