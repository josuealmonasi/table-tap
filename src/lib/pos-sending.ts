/** All replay hooks in this tab share the online send, even across a screen remount. */
const sending = new Set<string>();
const keyOf = (restaurant: string, reference: string) => `${restaurant}:${reference}`;

export function beginPosSend(restaurant: string, reference: string): () => void {
  const key = keyOf(restaurant, reference);
  sending.add(key);
  return () => { sending.delete(key); };
}

export function posSendInFlight(restaurant: string, reference: string): boolean {
  return sending.has(keyOf(restaurant, reference));
}
