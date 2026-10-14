"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import { CheckIcon } from "@/components/ui/icons";
import { setupLeft, type SetupStep } from "@/lib/setup-steps";

const HIDDEN = "tt-setup-hidden";

interface SetupChecklistProps {
  steps: SetupStep[];
}

/**
 * What a new restaurant still has to do to take orders and money, at the top
 * of the owner's home until it is done. Each line is worked out from what the
 * restaurant has, and opens the screen that does it. The owner may put it
 * away; that is remembered in this browser only.
 */
export default function SetupChecklist({ steps }: SetupChecklistProps) {
  const t = useT();
  const [hidden, setHidden] = useState(true);

  // Read after mounting: the server does not know what this browser put away.
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden || !setupLeft(steps)) return null;

  function hide(): void {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDDEN, "1");
    } catch {
      // Private mode: it goes away for this visit only.
    }
  }

  return (
    <div className="tt-section tt-setup">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("setup.title")}</h3>
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={hide}>{t("setup.hide")}</button>
      </div>
      <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>{t("setup.hint")}</p>
      <ol className="tt-setup-list">
        {steps.map(step => (
          <li key={step.key} className={`tt-setup-step${step.done ? " tt-setup-done" : ""}`}>
            <span className="tt-setup-mark" aria-hidden="true">{step.done && <CheckIcon size={14} weight="bold" />}</span>
            <span className="tt-setup-text">
              <strong>{t(`setup.${step.key}`)}</strong>
              {step.optional && <span className="tt-muted"> · {t("setup.optional")}</span>}
              <span className="tt-muted tt-setup-hint">{t(`setup.${step.key}Hint`)}</span>
            </span>
            {step.done ? (
              <span className="tt-muted tt-setup-state">{t("setup.done")}</span>
            ) : (
              <Link className="tt-btn tt-btn-ghost tt-btn-sm" href={step.href}>{t("setup.go")}</Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
