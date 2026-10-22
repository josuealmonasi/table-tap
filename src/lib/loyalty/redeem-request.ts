export interface RedemptionRequest {
  code: string;
  round: number;
  step: number;
  requestKey: string;
}

/** Keep an uncertain handover's key across retries, closing the dialog and reloads. */
export function redeemRequest(code: string, round: number, step: number): RedemptionRequest {
  const slot = `tt-loyalty-redeem:${code}:${round}:${step}`;
  const requestKey = localStorage.getItem(slot) ?? crypto.randomUUID();
  // Save before sending: a dropped response must not turn a retry into a new tap.
  localStorage.setItem(slot, requestKey);
  return { code, round, step, requestKey };
}

export function forgetRedeemRequest(request: RedemptionRequest): void {
  const slot = `tt-loyalty-redeem:${request.code}:${request.round}:${request.step}`;
  if (localStorage.getItem(slot) === request.requestKey) localStorage.removeItem(slot);
}
