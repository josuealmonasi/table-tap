import { retryCases } from "../api-retry-cases.mjs";

export function retriesCases(fx) {
  return [
    ...retryCases(fx),
  ];
}
