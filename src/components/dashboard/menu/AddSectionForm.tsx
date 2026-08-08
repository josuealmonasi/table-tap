"use client";

import { useState } from "react";
import AddInDialog from "@/components/ui/AddInDialog";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";

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
  const toast = useToast();
  const [name, setName] = useState("");

  return (
    <AddInDialog label={t("menu.addSection")} title={t("menu.addSection")} maxWidth={520}>
      {close => (
        <form
          className="tt-prodform"
          onSubmit={async e => {
            e.preventDefault();
            if (name.trim()) {
              await onAdd(name.trim());
              toast(t("done.sectionAdded"));
              setName("");
              close();
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
          <div className="tt-prodform-actions">
            <button
              className="tt-btn tt-btn-primary tt-btn-sm"
              type="submit"
              disabled={!name.trim()}
            >
              {t("menu.addSection")}
            </button>
          </div>
        </form>
      )}
    </AddInDialog>
  );
}
