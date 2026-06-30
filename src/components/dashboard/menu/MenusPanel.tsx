"use client";

import { useState } from "react";
import type { Menu } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { menuSlug } from "@/lib/slug";
import ReorderButtons from "@/components/ui/ReorderButtons";

/**
 * Dashboard panel listing a restaurant's menus. Clicking a menu opens it (to
 * add sections/products/extras). Each menu can be toggled on/off for customers
 * (switch + confirmation), renamed, or deleted (with confirmation). A brand-new
 * restaurant with no menus is invited to create its first one. A restaurant
 * always keeps at least one menu, and at least one menu stays active.
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
}: {
  menus: Menu[];
  onOpen: (menu: Menu) => void;
  onAdd: (name: string) => Promise<string | undefined>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
  onDuplicate: (id: string) => Promise<string | undefined>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const confirm = useConfirm();

  const activeCount = menus.filter((m) => m.active).length;
  const empty = menus.length === 0;

  // A name collides if it produces the same URL slug as an existing menu
  // (catches case- and punctuation-only differences too). exceptId skips the
  // menu being renamed.
  const nameTaken = (name: string, exceptId?: string) =>
    menus.some((m) => m.id !== exceptId && menuSlug(m.name) === menuSlug(name));

  async function toggle(menu: Menu, next: boolean) {
    if (!next && activeCount <= 1) {
      await confirm({
        title: "At least one menu must stay active",
        message: "Turn another menu on before hiding this one.",
        confirmLabel: "Got it",
        cancelLabel: "Close",
      });
      return;
    }
    const ok = await confirm(
      next
        ? {
            title: `Show “${menu.name}” to customers?`,
            message: "Its sections, products and extras become orderable right away.",
            confirmLabel: "Activate",
          }
        : {
            title: `Hide “${menu.name}” from customers?`,
            message: "Customers won't see this menu until you turn it back on. Nothing is deleted.",
            confirmLabel: "Deactivate",
          }
    );
    if (ok) await onToggleActive(menu.id, next);
  }

  async function remove(menu: Menu) {
    if (menus.length <= 1) {
      await confirm({
        title: "Can't delete the only menu",
        message: "A restaurant needs at least one menu. Add another first.",
        confirmLabel: "Got it",
        cancelLabel: "Close",
      });
      return;
    }
    const ok = await confirm({
      title: `Delete “${menu.name}”?`,
      message: "All of its sections, products and extras will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await onDelete(menu.id);
  }

  async function duplicate(menu: Menu) {
    const ok = await confirm({
      title: `Duplicate “${menu.name}”?`,
      message: "This makes a copy with all of its sections, products and extras. You can rename it afterward.",
      confirmLabel: "Duplicate",
    });
    if (ok) await onDuplicate(menu.id);
  }

  const addForm = (
    <>
      <form
        className="tt-add-section"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          if (nameTaken(name)) {
            setAddError(`You already have a menu called “${name}”.`);
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
          placeholder="Menu name (e.g. Breakfast)"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
          autoFocus
        />
        <button className="tt-btn tt-btn-primary" type="submit" disabled={!newName.trim()}>+ Add menu</button>
        {!empty && (
          <button type="button" className="tt-btn tt-btn-ghost" onClick={() => { setAdding(false); setNewName(""); setAddError(null); }}>Cancel</button>
        )}
      </form>
      {addError && <p className="tt-field-error">{addError}</p>}
    </>
  );

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>Menus</h3>
        {!empty && <span className="tt-muted" style={{ fontSize: 12 }}>Open a menu to edit it · switch it on to show it to customers</span>}
      </div>

      {empty ? (
        <div className="tt-empty">
          <div className="tt-empty-emoji">📋</div>
          <strong>Create your first menu</strong>
          <p className="tt-muted" style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 360 }}>
            Name it anything — e.g. “All Day”, “Breakfast” or “Dinner”. You can add as many as you like
            and turn each on or off through the day.
          </p>
          {addForm}
        </div>
      ) : (
        <>
          <div className="tt-menu-list">
            {menus.map((m, i) =>
              renamingId === m.id ? (
                <div key={m.id}>
                  <form
                    className="tt-menu-row"
                    style={{ gap: 8 }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const name = renameValue.trim();
                      if (!name) return;
                      if (nameTaken(name, m.id)) {
                        setRenameError(`You already have a menu called “${name}”.`);
                        return;
                      }
                      await onRename(m.id, name);
                      setRenamingId(null);
                    }}
                  >
                    <input
                      className="tt-input"
                      style={{ flex: 1 }}
                      value={renameValue}
                      onChange={(e) => { setRenameValue(e.target.value); setRenameError(null); }}
                      autoFocus
                    />
                    <button className="tt-btn tt-btn-primary tt-btn-sm" type="submit">Save</button>
                    <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setRenamingId(null)}>Cancel</button>
                  </form>
                  {renameError && <p className="tt-field-error">{renameError}</p>}
                </div>
              ) : (
                <div key={m.id} className="tt-menu-row">
                  <ReorderButtons
                    canMoveUp={i > 0}
                    canMoveDown={i < menus.length - 1}
                    onMoveUp={() => onMove(m.id, "up")}
                    onMoveDown={() => onMove(m.id, "down")}
                  />
                  <div className="tt-menu-body">
                    <button className="tt-menu-name" onClick={() => onOpen(m)}>
                      <span>{m.name}</span>
                      {!m.active && <span className="tt-badge" style={{ marginLeft: 8 }}>Hidden</span>}
                      <span className="tt-menu-open">Open →</span>
                    </button>
                    <div className="tt-menu-controls">
                      <label className="tt-switch" title={m.active ? "Visible to customers" : "Hidden"}>
                        <input type="checkbox" checked={m.active} onChange={(e) => toggle(m, e.target.checked)} />
                        <span className="tt-switch-track" />
                      </label>
                      <div className="tt-prod-actions">
                        <button className="tt-iconbtn" title="Rename" onClick={() => { setRenameValue(m.name); setRenameError(null); setRenamingId(m.id); }}>✏️</button>
                        <button className="tt-iconbtn" title="Duplicate menu" onClick={() => duplicate(m)}>📋</button>
                        <button className="tt-iconbtn" title="Delete menu" onClick={() => remove(m)}>🗑️</button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {adding ? (
            <div style={{ marginTop: 12 }}>{addForm}</div>
          ) : (
            <button className="tt-add-more" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>+ Add menu</button>
          )}
        </>
      )}
    </div>
  );
}
