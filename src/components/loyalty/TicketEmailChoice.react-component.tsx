"use client";

import { useT } from "@/lib/i18n/context";

interface TicketEmailChoiceProps {
  email: string;
  skip: boolean;
  onSkip: (skip: boolean) => void;
  disabled?: boolean;
}
export default function TicketEmailChoice({ email, skip, onSkip, disabled = false }: TicketEmailChoiceProps) {
  const t = useT();
  return <div>
    <p style={{ overflowWrap: "anywhere" }} role="status">{t("cardEmail.notice", { email })}</p>
    <label className="tt-check">
      <input type="checkbox" checked={skip} onChange={e => onSkip(e.target.checked)} disabled={disabled} />
      <span>{t("cardEmail.skip")}</span>
    </label>
  </div>;
}
