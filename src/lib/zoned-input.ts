/** datetime-local holds a wall clock, never an instant or the browser's zone. */
export function zonedInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Refuse skipped or repeated DST minutes rather than silently choose an hour. */
export function zonedTimestamp(local: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const wall = Date.parse(`${local}Z`);
  if (!Number.isFinite(wall)) return null;
  const offsetAt = (at: number) => Date.parse(`${zonedInput(new Date(at).toISOString(), timeZone)}Z`) - at;
  const offsets = new Set([-86400000, 0, 86400000].map(delta => offsetAt(wall + delta)));
  const matches = [...offsets].filter(offset => zonedInput(new Date(wall - offset).toISOString(), timeZone) === local);
  if (matches.length !== 1) return null;
  const minutes = matches[0] / 60000;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local}:00${minutes >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}
