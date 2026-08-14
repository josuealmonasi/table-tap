"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Menu } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import ReorderButtons from "@/components/ui/ReorderButtons";
import { DeleteIcon, DuplicateIcon, EditIcon, ScheduleIcon } from "@/components/ui/icons";
import ScheduleDialog from "./ScheduleDialog";
import {
  hasLiveSchedule,
  isMenuOpen,
  summarizeSchedule,
  type MenuSchedule,
} from "@/lib/menu-schedule";

interface MenuRowProps {
  menu: Menu;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: (menu: Menu) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onSetSchedule: (id: string, schedule: MenuSchedule | null) => Promise<void>;
  timeZone: string;
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
  onSetSchedule,
  timeZone,
  onToggle,
  onDuplicate,
  onDelete,
  onMove,
  nameTaken,
}: MenuRowProps) {
  const t = useT();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  // Sits between the name and the controls so the row reads
  // "what it is · when it shows · what you can do to it".
  const summary =
    menu.schedule && hasLiveSchedule(menu.schedule)
      ? summarizeSchedule(
          menu.schedule,
          [0, 1, 2, 3, 4, 5, 6].map(d => t(`sched.day${d}`)),
          t("sched.allDayShort"),
        )
      : null;
  const paused = Boolean(menu.schedule?.rules?.length) && !menu.schedule?.enabled;

  /**
   * Whether the schedule is serving *right now*.
   *
   * Computed after mount rather than during render: the server and the browser
   * evaluate "now" a moment apart, and a menu whose window has just opened
   * would hydrate with one answer and re-render with the other. Null until
   * mounted, so the badge simply isn't there for that first paint.
   *
   * Re-checked every 30s so the badge flips at the boundary instead of going
   * stale until the page is reloaded.
   */
  const [servingNow, setServingNow] = useState<boolean | null>(null);
  useEffect(() => {
    if (!summary) {
      setServingNow(null);
      return;
    }
    const check = () =>
      setServingNow(isMenuOpen(menu.active, menu.schedule, new Date(), timeZone));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [summary, menu.active, menu.schedule, timeZone]);
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
            toast(t("done.menuRenamed"));
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
            <button
              className="tt-btn tt-btn-primary tt-btn-sm"
              type="submit"
              disabled={!value.trim() || value.trim() === menu.name}
            >
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
      <ScheduleDialog
        open={scheduling}
        menuName={menu.name}
        schedule={menu.schedule}
        onClose={() => setScheduling(false)}
        onSave={s => onSetSchedule(menu.id, s)}
      />
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
        {(summary || paused) && (
          <div className="tt-menu-sched" title={summary?.join(" · ")}>
            <ScheduleIcon size={13} weight="bold" />
            {/* The hours alone don't say whether the menu is showing to
                customers at this moment, which is the thing an owner is
                actually checking. */}
            {summary && servingNow !== null && (
              <span
                className={`tt-sched-state ${servingNow ? "tt-sched-live" : "tt-sched-off"}`}
              >
                {t(servingNow ? "sched.servingNow" : "sched.outsideHours")}
              </span>
            )}
            <span>{paused ? t("sched.pausedSummary") : summary!.join(" · ")}</span>
          </div>
        )}
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
              title={t("sched.open")}
              onClick={() => setScheduling(true)}
            >
              <ScheduleIcon size={16} />
            </button>
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
