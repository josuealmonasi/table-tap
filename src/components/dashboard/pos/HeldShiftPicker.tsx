"use client";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import type { HeldShiftChoice } from "@/lib/held-shift";

interface HeldShiftPickerProps {
  shifts: HeldShiftChoice | null;
  value: string | null;
  onChange: (id: string) => void;
}

/**
 * The shift a held cash sale is recorded in, confirmed by the manager: the one
 * its till had open when it took the money, or the one open now (bl39 finding 2).
 */
export default function HeldShiftPicker({ shifts, value, onChange }: HeldShiftPickerProps) {
  const t = useT();
  const { locale } = useLocale();
  const when = (at: string) => new Date(at).toLocaleString(dateLocale(locale));
  const taken = shifts?.taken?.closed_at ? shifts.taken : null;
  const open = shifts?.open ?? null;
  if (!taken && !open) return <p className="tt-field-error" role="alert">{t("recovery.shiftNone")}</p>;
  return <fieldset className="tt-field">
    <legend>{t("recovery.shift")}</legend>
    {taken && <label style={{ display: "block" }}><input type="radio" name="held-shift" checked={value === taken.id} onChange={() => onChange(taken.id)} />{" "}
      {t("recovery.shiftTaken", { from: when(taken.opened_at), to: when(taken.closed_at!) })}</label>}
    {open && <label style={{ display: "block" }}><input type="radio" name="held-shift" checked={value === open.id} onChange={() => onChange(open.id)} />{" "}
      {t("recovery.shiftOpen", { from: when(open.opened_at) })}</label>}
    <p className="tt-muted">{t("recovery.shiftHelp")}</p>
  </fieldset>;
}
