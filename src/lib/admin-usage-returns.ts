import { receiptCents } from "@/lib/receipt-amount";

interface Operation { id: string; amount: number | string; tip: number | string }
interface Piece { id: string; operation_id: string; amount_cents: number; succeeded_at: string }

/** Earlier pieces fix the cents assigned to later ones, even across months. */
export function returnTips(operations: Operation[], pieces: Piece[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const operation of operations) {
    const amount = receiptCents(operation.amount), tip = receiptCents(operation.tip);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(tip) || tip < 0 || tip > amount) throw new Error("Could not verify return tip");
    let completed = 0;
    const sorted = pieces.filter(p => p.operation_id === operation.id)
      .sort((a, b) => Date.parse(a.succeeded_at) - Date.parse(b.succeeded_at) || a.id.localeCompare(b.id));
    for (const piece of sorted) {
      const before = completed;
      completed += piece.amount_cents;
      if (!Number.isSafeInteger(piece.amount_cents) || piece.amount_cents <= 0 || completed > amount
        || !Number.isFinite(Date.parse(piece.succeeded_at)) || result.has(piece.id)) throw new Error("Could not verify return pieces");
      result.set(piece.id, Number(BigInt(completed) * BigInt(tip) / BigInt(amount) - BigInt(before) * BigInt(tip) / BigInt(amount)));
    }
  }
  if (result.size !== pieces.length) throw new Error("Could not find return operation");
  return result;
}
