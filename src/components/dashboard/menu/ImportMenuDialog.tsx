"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { parseCsv } from "@/lib/csv";
import { planImport, sectionsOf, type ImportPlan, type ImportRow } from "@/lib/menu-import";

interface ImportMenuDialogProps {
  open: boolean;
  /** Start from the café template rather than an empty form. */
  withTemplate: boolean;
  currency: string;
  /** Names of the products this menu already has, which an import skips. */
  existingNames: string[];
  onClose: () => void;
  /** Writes the rows; resolves to how many products were added. */
  onImport: (rows: ImportRow[]) => Promise<number>;
}

/** How many lines of the preview to show before "and N more". */
const PREVIEW = 8;

/**
 * Bringing a menu in from a spreadsheet, or starting from the café template.
 * The sheet is read in the browser and shown — what will be added, which
 * sections will be made, and every line that will not go in and why —
 * before anything is written.
 */
export default function ImportMenuDialog({
  open,
  withTemplate,
  currency,
  existingNames,
  onClose,
  onImport,
}: ImportMenuDialogProps) {
  const t = useT();
  const toast = useToast();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  const fromText = (text: string) => setPlan(planImport(parseCsv(text), existingNames));

  // Each time it opens it starts afresh — with the template already read in
  // when that is what was asked for.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPlan(withTemplate ? planImport(parseCsv(t("menuImport.cafeCsv")), existingNames) : null);
  }

  async function readFile(file: File | undefined): Promise<void> {
    if (!file) return;
    fromText(await file.text());
  }

  /** The template as a file: the format, with a café's menu in it. */
  function download(): void {
    const blob = new Blob([`﻿${t("menuImport.cafeCsv")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = t("menuImport.templateFile");
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importAll(): Promise<void> {
    if (!plan?.rows.length) return;
    setBusy(true);
    try {
      const added = await onImport(plan.rows);
      if (added > 0) {
        toast(t("menuImport.done", { n: added }));
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const newSections = plan ? sectionsOf(plan.rows) : [];
  return (
    <Modal open={open} onClose={onClose} maxWidth={620} title={t("menuImport.title")}>
      <div className="tt-prodform">
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>{t("menuImport.hint")}</p>
        <div className="tt-import-source">
          <label className="tt-field">
            <span className="tt-mod-label">{t("menuImport.file")}</span>
            <input
              className="tt-input"
              type="file"
              accept=".csv,text/csv"
              onChange={e => void readFile(e.target.files?.[0])}
            />
          </label>
          <div className="tt-import-links">
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={download}>
              {t("menuImport.download")}
            </button>
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => fromText(t("menuImport.cafeCsv"))}>
              {t("menuImport.useTemplate")}
            </button>
          </div>
        </div>

        {plan?.missingColumns && <p className="tt-field-error" role="alert">{t("menuImport.missingColumns")}</p>}

        {plan && !plan.missingColumns && (
          <div className="tt-import-plan">
            <strong>{plan.rows.length > 0 ? t("menuImport.summary", { n: plan.rows.length }) : t("menuImport.empty")}</strong>
            {newSections.length > 0 && (
              <span className="tt-muted">{t("menuImport.sections", { names: newSections.join(", ") })}</span>
            )}
            {plan.rows.length > 0 && (
              <div className="tt-import-scroll">
                <table className="tt-import-table">
                  <thead>
                    <tr>
                      <th>{t("menuImport.colSection")}</th>
                      <th>{t("menuImport.colProduct")}</th>
                      <th>{t("menuImport.colPrice")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.slice(0, PREVIEW).map(row => (
                      <tr key={row.line}>
                        <td>{row.category ?? "—"}</td>
                        <td>{row.emoji} {row.name}</td>
                        <td>{formatMoney(row.price, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.rows.length > PREVIEW && (
                  <span className="tt-muted">{t("menuImport.more", { n: plan.rows.length - PREVIEW })}</span>
                )}
              </div>
            )}
            {plan.problems.length > 0 && (
              <div className="tt-import-problems" role="status">
                <strong>{t("menuImport.problemsTitle")}</strong>
                <ul>
                  {plan.problems.map(p => (
                    <li key={p.line}>
                      {t("menuImport.line", { n: p.line })}
                      {p.name ? ` · ${p.name}` : ""} — {t(`menuImport.reason.${p.reason}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="tt-prodform-actions">
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            disabled={busy || !plan?.rows.length}
            onClick={() => void importAll()}
          >
            {busy ? t("common.saving") : t("menuImport.action", { n: plan?.rows.length ?? 0 })}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("menu.cancel")}</button>
        </div>
      </div>
    </Modal>
  );
}
