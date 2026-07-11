"use client";

import { useState } from "react";
import type { Menu } from "@/lib/types";
import ReorderButtons from "@/components/ui/ReorderButtons";

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
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (renaming) {
    return (
      <div>
        <form
          className="tt-menu-row"
          style={{ gap: 8 }}
          onSubmit={async e => {
            e.preventDefault();
            const name = value.trim();
            if (!name) return;
            if (nameTaken(name, menu.id)) {
              setError(`You already have a menu called “${name}”.`);
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
          <button className="tt-btn tt-btn-primary tt-btn-sm" type="submit">
            Save
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => setRenaming(false)}
          >
            Cancel
          </button>
        </form>
        {error && <p className="tt-field-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="tt-menu-row">
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
              Hidden
            </span>
          )}
          <span className="tt-menu-open">Open →</span>
        </button>
        <div className="tt-menu-controls">
          <label
            className="tt-switch"
            title={menu.active ? "Visible to customers" : "Hidden"}
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
              title="Rename"
              onClick={() => {
                setValue(menu.name);
                setError(null);
                setRenaming(true);
              }}
            >
              ✏️
            </button>
            <button
              className="tt-iconbtn"
              title="Duplicate menu"
              onClick={() => onDuplicate(menu)}
            >
              📋
            </button>
            <button
              className="tt-iconbtn"
              title="Delete menu"
              onClick={() => onDelete(menu)}
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
