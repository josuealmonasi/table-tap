"use client";

import Link from "next/link";
import type { Menu } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import MenuSwitcher from "./MenuSwitcher";

interface EditorHeaderProps {
  menus: Menu[];
  menuId: string;
  menuName: string;
  onRenameMenu: (id: string, name: string) => Promise<void>;
  nameTaken: (name: string, exceptId?: string) => boolean;
  /** Hidden while the editor is loading or the menu is empty. */
  showTools: boolean;
  search: string;
  onSearch: (value: string) => void;
  selecting: boolean;
  onToggleSelecting: () => void;
}

/** Menu editor header: breadcrumb + menu switcher, search box, select toggle. */
export default function EditorHeader({
  menus,
  menuId,
  menuName,
  onRenameMenu,
  nameTaken,
  showTools,
  search,
  onSearch,
  selecting,
  onToggleSelecting,
}: EditorHeaderProps) {
  const t = useT();
  return (
    <header className="tt-dash-head">
      <nav className="tt-breadcrumb" aria-label="Breadcrumb">
        <Link href="/dashboard">{t("nav.dashboard")}</Link>
        <span className="tt-breadcrumb-sep">/</span>
        <MenuSwitcher
          menus={menus}
          currentId={menuId}
          currentName={menuName}
          onRename={onRenameMenu}
          nameTaken={nameTaken}
        />
      </nav>
      {showTools && (
        <div className="tt-editor-tools">
          <input
            className="tt-input tt-menu-search"
            type="search"
            placeholder={t("menu.searchProducts")}
            aria-label={t("menu.searchProducts")}
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
          <button
            type="button"
            className={`tt-btn tt-btn-sm ${selecting ? "tt-btn-primary" : "tt-btn-ghost"}`}
            onClick={onToggleSelecting}
          >
            {selecting ? t("menu.doneBtn") : t("menu.select")}
          </button>
        </div>
      )}
    </header>
  );
}
