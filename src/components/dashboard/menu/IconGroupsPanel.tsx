"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useIconGroups } from "@/hooks/useIconGroups";
import type { StoredIconGroup } from "@/lib/icon-groups";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";
import IconGroupForm from "./IconGroupForm";

/**
 * Los grupos del selector de iconos, del restaurante.
 *
 * Mismo trato que los extras: el nombre abre el editor, el lápiz también, y la
 * baja pregunta antes. Los de fábrica no salen aquí — no se pueden tocar, y
 * enseñar filas que no se dejan editar sólo invita a intentarlo.
 */
export default function IconGroupsPanel({ groups }: { groups: StoredIconGroup[] }) {
  const t = useT();
  const confirm = useConfirm();
  const { busy, addGroup, updateGroup, deleteGroup } = useIconGroups();
  const [editing, setEditing] = useState<StoredIconGroup | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("menu.iconGroupsTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("menu.iconGroupsHint")}
        </span>
      </div>

      {groups.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {t("menu.iconGroupsEmpty")}
        </p>
      )}

      {groups.map(group => (
        <div key={group.id} className="tt-prod">
          <div className="tt-prod-body">
            <div className="tt-prod-thumb">
              <span>{group.items[0]?.emoji ?? "🎨"}</span>
            </div>
            <div style={{ flex: 1 }}>
              <button
                type="button"
                className="tt-prod-name"
                onClick={() => setEditing(group)}
                title={t("menu.edit")}
              >
                {group.name}
              </button>
              <div className="tt-muted" style={{ fontSize: 13, marginTop: 2 }}>
                {group.items.map(i => i.emoji).join(" ")}
              </div>
            </div>
            <div className="tt-prod-right">
              <span className="tt-badge">
                {t(group.variant === "addon" ? "menu.forExtras" : "menu.forProducts")}
              </span>
              <div className="tt-prod-actions">
                <button
                  className="tt-iconbtn"
                  title={t("menu.edit")}
                  onClick={() => setEditing(group)}
                >
                  <EditIcon size={16} />
                </button>
                <button
                  className="tt-iconbtn"
                  title={t("menu.delete")}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("menu.deleteIconGroupConfirm", { name: group.name }),
                      // Los platillos guardan el emoji, no el grupo: borrarlo no
                      // les quita el icono que ya tienen puesto.
                      message: t("menu.deleteIconGroupMsg"),
                      confirmLabel: t("common.delete"),
                      danger: true,
                    });
                    if (ok) await deleteGroup(group.id);
                  }}
                >
                  <DeleteIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      <button
        className="tt-add-more"
        style={{ marginTop: 10 }}
        onClick={() => setAdding(true)}
      >
        {t("menu.addIconGroup")}
      </button>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        maxWidth={480}
        title={t("menu.addIconGroup")}
      >
        <IconGroupForm
          busy={busy}
          submitLabel={t("menu.addIconGroup")}
          onCancel={() => setAdding(false)}
          onSubmit={async input => {
            if (await addGroup(input)) setAdding(false);
          }}
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        maxWidth={480}
        title={t("common.editingNamed", { name: editing?.name ?? "" })}
      >
        {editing && (
          <IconGroupForm
            busy={busy}
            submitLabel={t("menu.saveShort")}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={async input => {
              if (await updateGroup(editing.id, input)) setEditing(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
