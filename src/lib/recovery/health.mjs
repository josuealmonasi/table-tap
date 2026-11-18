/** A daily fallback must not hide a failed five-minute database schedule. */
export function schedulerHealth(production, last, error, now = Date.now()) {
  if (!production) return { ok: true, status: "skipped: no scheduler on dev" };
  const age = now - Date.parse(last ?? "");
  const ok = !error && Number.isFinite(age) && age >= 0 && age < 15 * 60_000;
  return { ok, status: ok ? "healthy" : "no successful database recovery in 15 minutes" };
}
