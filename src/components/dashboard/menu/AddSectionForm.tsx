"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

interface AddSectionFormProps {
  onAdd: (name: string) => Promise<unknown>;
  autoFocus?: boolean;
}

/** Name input + submit button for creating a new section in the open menu. */
export default function AddSectionForm({
  onAdd,
  autoFocus = false,
}: AddSectionFormProps) {
  const t = useT();
  const [name, setName] = useState("");

  return (
    <form
      className="tt-add-section"
      onSubmit={async e => {
        e.preventDefault();
        if (name.trim()) {
          await onAdd(name.trim());
          setName("");
        }
      }}
    >
      <input
        className="tt-input"
        placeholder={t("menu.newSectionPlaceholder")}
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus={autoFocus}
      />
      <button className="tt-btn tt-btn-primary" type="submit" disabled={!name.trim()}>
        {t("menu.addSection")}
      </button>
    </form>
  );
}
