"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Menu } from "@/lib/types";
import { menuSlug } from "@/lib/slug";
import { useT } from "@/lib/i18n/context";
import { EditIcon, ExpandIcon } from "@/components/ui/icons";

/**
 * Breadcrumb-style control for the menu editor header: shows the current menu
 * name, opens a dropdown to jump straight to any other menu, and lets you
 * rename the current menu in place (keeping the URL's slug in sync via
 * router.replace, since /dashboard/{menu-name} routes are name-derived).
 */
interface MenuSwitcherProps {
  menus: Menu[];
  currentId: string;
  currentName: string;
  onRename: (id: string, name: string) => Promise<void>;
  nameTaken: (name: string, exceptId?: string) => boolean;
}

export default function MenuSwitcher({
  menus,
  currentId,
  currentName,
  onRename,
  nameTaken,
}: MenuSwitcherProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (!name || name === currentName) {
      setRenaming(false);
      return;
    }
    if (nameTaken(name, currentId)) {
      setError(t("menu.nameTaken", { name }));
      return;
    }
    await onRename(currentId, name);
    setRenaming(false);
    setOpen(false);
    router.replace(`/dashboard/${menuSlug(name)}`);
  }

  const current = menus.find(m => m.id === currentId);
  const renameChanged = Boolean(value.trim() && value.trim() !== (current?.name ?? ""));

  function cancelRename() {
    setValue(current?.name ?? "");
    setError(null);
    setRenaming(false);
  }

  if (renaming) {
    return (
      <div ref={ref} style={{ display: "inline-block" }}>
        <form
          className="tt-menu-switcher-rename"
          onSubmit={submitRename}
          // Escape or clicking away abandons the edit, matching every other
          // text field on the page.
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) cancelRename();
          }}
          onKeyDown={e => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
        >
          <input
            className="tt-input"
            style={{ width: 220 }}
            value={value}
            onChange={e => {
              setValue(e.target.value);
              setError(null);
            }}
            autoFocus
            onFocus={e => e.target.select()}
          />
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            type="submit"
            disabled={!renameChanged}
          >
            {t("menu.save")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => {
              setRenaming(false);
              setOpen(false);
            }}
          >
            {t("menu.cancel")}
          </button>
        </form>
        {error && <p className="tt-field-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="tt-menu-switcher" ref={ref}>
      <button
        type="button"
        className="tt-breadcrumb-current tt-menu-switcher-btn"
        aria-current="page"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {currentName}
        {menus.length > 1 && (
          <ExpandIcon size={13} weight="bold" className="tt-menu-switcher-caret" />
        )}
      </button>
      <button
        type="button"
        className="tt-iconbtn tt-menu-switcher-edit"
        title={t("menu.rename")}
        onClick={() => {
          setValue(currentName);
          setError(null);
          setRenaming(true);
          setOpen(false);
        }}
      >
        <EditIcon size={16} />
      </button>

      {open && menus.length > 1 && (
        <div className="tt-menu-switcher-menu" role="menu">
          {menus.map(m => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              className={`tt-menu-switcher-item ${m.id === currentId ? "tt-menu-switcher-item-active" : ""}`}
              onClick={() => {
                setOpen(false);
                if (m.id !== currentId) router.push(`/dashboard/${menuSlug(m.name)}`);
              }}
            >
              {m.name}
              {!m.active && (
                <span className="tt-badge" style={{ marginLeft: 8 }}>
                  {t("menu.hidden")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
