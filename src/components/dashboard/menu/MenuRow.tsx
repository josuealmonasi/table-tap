"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Menu } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import ReorderButtons from "@/components/ui/ReorderButtons";
import { DeleteIcon, DuplicateIcon, EditIcon } from "@/components/ui/icons";

interface MenuRowProps {
  menu: Menu;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: (menu: Menu) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onToggle: (menu: Menu, next: boolean) => Promise<void>;
  onDuplicate: (menu: Menu) => Promise<void>;
  onDelete: (menu: Menu) => Promise<void>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
  /** True when `name` would collide with another menu's URL slug. */
  nameTaken: (name: string, exceptId?: string) => boolean;
}

/** One dashboard menu row: reorder arrows, open button, visibility switch, rename/duplicate/delete. */
export default function MenuRow({
  menu,
  canMoveUp,
  canMoveDown,
  onOpen,
  onRename,
  onToggle,
  onDuplicate,
  onDelete,
  onMove,
  nameTaken,
}: MenuRowProps) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const renameDialog = (
    <Modal
      open={renaming}
      onClose={() => setRenaming(false)}
      maxWidth={460}
      title={t("common.editingNamed", { name: menu.name })}
    >
      <div>
        <form
          className="tt-prodform"
          onSubmit={async e => {
            e.preventDefault();
            const name = value.trim();
            if (!name) return;
            if (nameTaken(name, menu.id)) {
              setError(t("menu.nameTaken", { name }));
              return;
            }
            await onRename(menu.id, name);
            setRenaming(false);
          }}
        >
          <input
            className="tt-input"
            style={{ flex: 1 }}
            value={value}
            onChange={e => {
              setValue(e.target.value);
              setError(null);
            }}
            autoFocus
          />
          <div className="tt-prodform-actions">
            <button className="tt-btn tt-btn-primary tt-btn-sm" type="submit">
              {t("menu.save")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => setRenaming(false)}
            >
              {t("menu.cancel")}
            </button>
          </div>
        </form>
        {error && <p className="tt-field-error">{error}</p>}
      </div>
    </Modal>
  );

  return (
    <div className="tt-menu-row">
      {renameDialog}
      <ReorderButtons
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={() => onMove(menu.id, "up")}
        onMoveDown={() => onMove(menu.id, "down")}
      />
      <div className="tt-menu-body">
        <button className="tt-menu-name" onClick={() => onOpen(menu)}>
          <span>{menu.name}</span>
          {!menu.active && (
            <span className="tt-badge" style={{ marginLeft: 8 }}>
              {t("menu.hidden")}
            </span>
          )}
          <span className="tt-menu-open">{t("menu.open")}</span>
        </button>
        <div className="tt-menu-controls">
          <label
            className="tt-switch"
            title={t(menu.active ? "menu.visibleToCustomers" : "menu.hiddenTitle")}
          >
            <input
              type="checkbox"
              checked={menu.active}
              onChange={e => onToggle(menu, e.target.checked)}
            />
            <span className="tt-switch-track" />
          </label>
          <div className="tt-prod-actions">
            <button
              className="tt-iconbtn"
              title={t("menu.rename")}
              onClick={() => {
                setValue(menu.name);
                setError(null);
                setRenaming(true);
              }}
            >
              <EditIcon size={16} />
            </button>
            <button
              className="tt-iconbtn"
              title={t("menu.duplicateMenu")}
              onClick={() => onDuplicate(menu)}
            >
              <DuplicateIcon size={16} />
            </button>
            <button
              className="tt-iconbtn"
              title={t("menu.deleteMenu")}
              onClick={() => onDelete(menu)}
            >
              <DeleteIcon size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
