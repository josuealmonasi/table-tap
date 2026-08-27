"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useDietaryTags } from "@/hooks/useDietaryTags";
import { isBuiltIn, tagLabel, type StoredDietaryTag } from "@/lib/dietary";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";
import DietaryTagForm from "./DietaryTagForm";

/**
 * The restaurant's dietary and allergen tags.
 *
 * Eight came fixed in the code; now they can be added, renamed and removed.
 * The built-ins can be removed like any other — a seafood restaurant does not
 * need "contains seafood" across the whole menu — but they are shown
 * translated, because the app names them and not the restaurant.
 */
export default function DietaryPanel({ tags }: { tags: StoredDietaryTag[] }) {
  const t = useT();
  const confirm = useConfirm();
  const { busy, addTag, updateTag, deleteTag } = useDietaryTags();
  const [editing, setEditing] = useState<StoredDietaryTag | null>(null);
  const [adding, setAdding] = useState(false);

  const nameOf = (tag: StoredDietaryTag) =>
    tagLabel({ key: tag.key, label: tag.label, labelEn: tag.label_en, emoji: tag.emoji }, t);

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("menu.dietaryAllergens")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("menu.shownToCustomers")}
        </span>
      </div>

      {tags.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {t("menu.dietaryEmpty")}
        </p>
      )}

      {tags.map(tag => (
        <div key={tag.id} className="tt-prod">
          <div className="tt-prod-body">
            <div className="tt-prod-thumb">
              <span>{tag.emoji}</span>
            </div>
            <div style={{ flex: 1 }}>
              <button
                type="button"
                className="tt-prod-name"
                onClick={() => setEditing(tag)}
                title={t("menu.edit")}
              >
                {nameOf(tag)}
              </button>
              {/* El inglés sólo si lo pusieron: las de casa ya vienen traducidas
                  y repetirlo aquí sería decir dos veces lo mismo. */}
              {!isBuiltIn(tag.key) && tag.label_en && (
                <div className="tt-muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {tag.label_en}
                </div>
              )}
            </div>
            <div className="tt-prod-actions">
              <button
                className="tt-iconbtn"
                title={t("menu.edit")}
                onClick={() => setEditing(tag)}
              >
                <EditIcon size={16} />
              </button>
              <button
                className="tt-iconbtn"
                title={t("menu.delete")}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("menu.deleteDietaryConfirm", { name: nameOf(tag) }),
                    message: t("menu.deleteDietaryMsg"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  });
                  if (ok) await deleteTag(tag.id);
                }}
              >
                <DeleteIcon size={16} />
              </button>
            </div>
          </div>
        </div>
      ))}

      <button className="tt-add-more" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
        {t("menu.addDietary")}
      </button>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        maxWidth={480}
        title={t("menu.addDietary")}
      >
        <DietaryTagForm
          busy={busy}
          submitLabel={t("menu.addDietary")}
          onCancel={() => setAdding(false)}
          onSubmit={async input => {
            if (await addTag(input)) setAdding(false);
          }}
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        maxWidth={480}
        title={t("common.editingNamed", { name: editing ? nameOf(editing) : "" })}
      >
        {editing && (
          <DietaryTagForm
            busy={busy}
            submitLabel={t("menu.saveShort")}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={async input => {
              if (await updateTag(editing.id, input)) setEditing(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
