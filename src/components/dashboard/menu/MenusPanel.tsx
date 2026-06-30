"use client";

import { useState } from "react";
import type { Menu } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/**
 * Manages a restaurant's menus: select which one to edit, toggle each on/off
 * for customers (switch + confirmation), rename, delete (with confirmation),
 * and add new ones. A restaurant always keeps at least one menu, and at least
 * one menu stays active.
 */
export default function MenusPanel({
  menus,
  selectedMenuId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onToggleActive,
}: {
  menus: Menu[];
  selectedMenuId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string) => Promise<string | undefined>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const confirm = useConfirm();

  const activeCount = menus.filter((m) => m.active).length;

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

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>Menus</h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>Switch a menu on to show it to customers</span>
      </div>

      <div className="tt-menu-list">
        {menus.map((m) =>
          renamingId === m.id ? (
            <form
              key={m.id}
              className="tt-menu-row"
              style={{ gap: 8 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (renameValue.trim()) await onRename(m.id, renameValue.trim());
                setRenamingId(null);
              }}
            >
              <input
                className="tt-input"
                style={{ flex: 1 }}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
              <button className="tt-btn tt-btn-primary tt-btn-sm" type="submit">Save</button>
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setRenamingId(null)}>Cancel</button>
            </form>
          ) : (
            <div key={m.id} className={`tt-menu-row ${m.id === selectedMenuId ? "tt-menu-row-active" : ""}`}>
              <button className="tt-menu-name" onClick={() => onSelect(m.id)}>
                {m.name}
                {!m.active && <span className="tt-badge" style={{ marginLeft: 8 }}>Hidden</span>}
                {m.id === selectedMenuId && <span className="tt-muted" style={{ marginLeft: 8, fontSize: 12 }}>· editing</span>}
              </button>
              <label className="tt-switch" title={m.active ? "Visible to customers" : "Hidden"}>
                <input type="checkbox" checked={m.active} onChange={(e) => toggle(m, e.target.checked)} />
                <span className="tt-switch-track" />
              </label>
              <div className="tt-prod-actions">
                <button className="tt-iconbtn" title="Rename" onClick={() => { setRenameValue(m.name); setRenamingId(m.id); }}>✏️</button>
                <button className="tt-iconbtn" title="Delete menu" onClick={() => remove(m)}>🗑️</button>
              </div>
            </div>
          )
        )}
      </div>

      {adding ? (
        <form
          className="tt-add-section"
          style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            const id = await onAdd(name);
            setNewName("");
            setAdding(false);
            if (id) onSelect(id);
          }}
        >
          <input
            className="tt-input"
            placeholder="Menu name (e.g. Breakfast)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <button className="tt-btn tt-btn-primary" type="submit" disabled={!newName.trim()}>+ Add menu</button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</button>
        </form>
      ) : (
        <button className="tt-add-more" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>+ Add menu</button>
      )}
    </div>
  );
}
