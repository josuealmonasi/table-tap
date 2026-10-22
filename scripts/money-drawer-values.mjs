// #527 reached main at this time. Earlier writers could not sign manifests
// or freeze a drawer's currency; missing evidence after this date is a failure.
export const DRAWER_ERA = "2026-10-22T00:44:04Z";
export const cents = value => value == null ? NaN : Math.round(Number(value) * 100);
export const time = value => value == null ? NaN : Date.parse(value);
