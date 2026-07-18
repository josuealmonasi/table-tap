"use client";

import { useState } from "react";
import type { Menu } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { menuSlug } from "@/lib/slug";
import { useT } from "@/lib/i18n/context";
import MenuRow from "./MenuRow";

interface MenusPanelProps {
  menus: Menu[];
  onOpen: (menu: Menu) => void;
  onAdd: (name: string) => Promise<string | undefined>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
  onDuplicate: (id: string) => Promise<string | undefined>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
}

/**
 * Dashboard panel listing a restaurant's menus. Clicking a menu opens it (to
 * add sections/products/extras). Each menu can be toggled on/off for customers
 * (switch + confirmation), reordered, renamed, duplicated, or deleted (with
 * confirmation). A brand-new restaurant with no menus is invited to create its
 * first one. A restaurant always keeps at least one menu, and at least one
 * menu stays active.
 */
export default function MenusPanel({
  menus,
  onOpen,
  onAdd,
  onRename,
  onDelete,
  onToggleActive,
  onDuplicate,
  onMove,
}: MenusPanelProps) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const confirm = useConfirm();

  const activeCount = menus.filter(m => m.active).length;
  const empty = menus.length === 0;

  // A name collides if it produces the same URL slug as an existing menu
  // (catches case- and punctuation-only differences too). exceptId skips the
  // menu being renamed.
  const nameTaken = (name: string, exceptId?: string) =>
    menus.some(m => m.id !== exceptId && menuSlug(m.name) === menuSlug(name));

  async function toggle(menu: Menu, next: boolean) {
    if (!next && activeCount <= 1) {
      await confirm({
        title: t("menu.keepOneActive"),
        message: t("menu.keepOneActiveMsg"),
        confirmLabel: t("menu.gotIt"),
        cancelLabel: t("menu.close"),
      });
      return;
    }
    const ok = await confirm(
      next
        ? {
            title: t("menu.showConfirm", { name: menu.name }),
            message: t("menu.showConfirmMsg"),
            confirmLabel: t("menu.activate"),
          }
        : {
            title: t("menu.hideConfirm", { name: menu.name }),
            message: t("menu.hideConfirmMsg"),
            confirmLabel: t("menu.deactivate"),
          },
    );
    if (ok) await onToggleActive(menu.id, next);
  }

  async function remove(menu: Menu) {
    if (menus.length <= 1) {
      await confirm({
        title: t("menu.cantDeleteOnly"),
        message: t("menu.cantDeleteOnlyMsg"),
        confirmLabel: t("menu.gotIt"),
        cancelLabel: t("menu.close"),
      });
      return;
    }
    const ok = await confirm({
      title: t("menu.deleteConfirm", { name: menu.name }),
      message: t("menu.deleteMenuMsg"),
      confirmLabel: t("menu.delete"),
      danger: true,
    });
    if (ok) await onDelete(menu.id);
  }

  async function duplicate(menu: Menu) {
    const ok = await confirm({
      title: t("menu.duplicateConfirm", { name: menu.name }),
      message: t("menu.duplicateMsg"),
      confirmLabel: t("menu.duplicate"),
    });
    if (ok) await onDuplicate(menu.id);
  }

  const addForm = (
    <>
      <form
        className="tt-add-section"
        onSubmit={async e => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          if (nameTaken(name)) {
            setAddError(t("menu.nameTaken", { name }));
            return;
          }
          const id = await onAdd(name);
          setNewName("");
          setAddError(null);
          setAdding(false);
          // Open the new menu right away so the user can start adding items.
          if (id) onOpen({ id, name } as Menu);
        }}
      >
        <input
          className="tt-input"
          placeholder={t("menu.menuNamePlaceholder")}
          value={newName}
          onChange={e => {
            setNewName(e.target.value);
            setAddError(null);
          }}
          autoFocus
        />
        <button
          className="tt-btn tt-btn-primary"
          type="submit"
          disabled={!newName.trim()}
        >
          {t("menu.addMenu")}
        </button>
        {!empty && (
          <button
            type="button"
            className="tt-btn tt-btn-ghost"
            onClick={() => {
              setAdding(false);
              setNewName("");
              setAddError(null);
            }}
          >
            {t("menu.cancel")}
          </button>
        )}
      </form>
      {addError && <p className="tt-field-error">{addError}</p>}
    </>
  );

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("menu.title")}
        </h3>
        {!empty && (
          <span className="tt-muted" style={{ fontSize: 12 }}>
            {t("menu.hint")}
          </span>
        )}
      </div>

      {empty ? (
        <div className="tt-empty">
          <div className="tt-empty-emoji">📋</div>
          <strong>{t("menu.createFirst")}</strong>
          <p
            className="tt-muted"
            style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 360 }}
          >
            {t("menu.createFirstDesc")}
          </p>
          {addForm}
        </div>
      ) : (
        <>
          <div className="tt-menu-list">
            {menus.map((m, i) => (
              <MenuRow
                key={m.id}
                menu={m}
                canMoveUp={i > 0}
                canMoveDown={i < menus.length - 1}
                onOpen={onOpen}
                onRename={onRename}
                onToggle={toggle}
                onDuplicate={duplicate}
                onDelete={remove}
                onMove={onMove}
                nameTaken={nameTaken}
              />
            ))}
          </div>

          {adding ? (
            <div style={{ marginTop: 12 }}>{addForm}</div>
          ) : (
            <button
              className="tt-add-more"
              style={{ marginTop: 12 }}
              onClick={() => setAdding(true)}
            >
              {t("menu.addMenu")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
