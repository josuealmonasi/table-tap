"use client";

import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import type { SettingsInput } from "@/hooks/useSettings";
import {
  FISCAL_FIELDS, FISCAL_KEYS, MEXICAN_STATES, TAX_REGIMES, validFiscalValue,
  type FiscalField, type FiscalSettings,
} from "@/lib/fiscal-settings";
import { useT } from "@/lib/i18n/context";

interface FiscalCardProps {
  fiscal: FiscalSettings;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}

/** Mounted only in the owner's restaurant settings group. */
export default function FiscalCard({ fiscal, saving, save }: FiscalCardProps): React.JSX.Element {
  const t = useT();
  const id = useId();
  const [values, setValues] = useState<FiscalSettings>(fiscal);
  const [errors, setErrors] = useState<Partial<Record<FiscalField, boolean>>>({});

  function changeField(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
    const field = event.target.name as FiscalField;
    const value = field === "rfc" ? event.target.value.toUpperCase() : event.target.value;
    setValues(previous => ({ ...previous, [field]: value }));
    if (errors[field]) setErrors(previous => ({ ...previous, [field]: !validFiscalValue(field, value.trim()) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const invalid = Object.fromEntries(FISCAL_KEYS.map(field => [field, !validFiscalValue(field, values[field]?.trim() ?? "")]));
    setErrors(invalid);
    if (Object.values(invalid).some(Boolean)) return;
    await save(Object.fromEntries(FISCAL_KEYS.map(field => [field, values[field]?.trim() || null])));
  }

  return (
    <section className="tt-section" aria-labelledby={`${id}-title`}>
      <div className="tt-section-head">
        <h3 id={`${id}-title`} className="tt-serif" style={{ margin: 0 }}>{t("fiscal.title")}</h3>
      </div>
      <p className="tt-muted" style={{ fontSize: 12 }}>{t("fiscal.hint")}</p>
      <form className="tt-prodform" onSubmit={submit} noValidate>
        {FISCAL_KEYS.map(field => {
          const select = field === "tax_regime" || field === "address_state";
          return (
            <label className="tt-field" key={field}>
              <span className="tt-mod-label">{t(`fiscal.fields.${field}`)}</span>
              {select ? (
                <select className="tt-input" name={field} value={values[field] ?? ""} onChange={changeField}
                  aria-invalid={errors[field] || undefined} aria-describedby={errors[field] ? `${id}-${field}` : undefined}>
                  <option value="">{t("fiscal.unset")}</option>
                  {field === "tax_regime"
                    ? TAX_REGIMES.map(code => <option key={code} value={code}>{code} — {t(`fiscal.regimes.${code}`)}</option>)
                    : MEXICAN_STATES.map(state => <option key={state} value={state}>{t(`fiscal.states.${state}`)}</option>)}
                </select>
              ) : (
                <input className="tt-input" name={field} value={values[field] ?? ""} onChange={changeField}
                  type={field === "ticket_phone" ? "tel" : "text"}
                  inputMode={field === "address_postal_code" ? "numeric" : undefined}
                  autoCapitalize={field === "rfc" ? "characters" : undefined}
                  spellCheck={field === "rfc" ? false : undefined}
                  maxLength={FISCAL_FIELDS[field].max}
                  aria-invalid={errors[field] || undefined} aria-describedby={errors[field] ? `${id}-${field}` : undefined} />
              )}
              {errors[field] && <span id={`${id}-${field}`} className="tt-field-error" role="alert">{t(`fiscal.errors.${field}`)}</span>}
            </label>
          );
        })}
        <div className="tt-prodform-actions">
          <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </section>
  );
}
