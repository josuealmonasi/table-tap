"use client";

import { useUserLogs } from "@/hooks/useUserLogs";
import { useT } from "@/lib/i18n/context";
import { ListSkeleton } from "@/components/ui/Skeleton";

interface UserLogsProps {
  restaurantId: string;
}

/** Owner-only activity log: who created/updated/deleted which login. */
export default function UserLogs({ restaurantId }: UserLogsProps) {
  const t = useT();
  const { logs, loading, page, pages, total, setPage } = useUserLogs(restaurantId);

  // "manager1@… created a new kitchen user" — role name is localised too.
  const describe = (action: string, role: string): string => {
    const roleName = t(`dash.${role}`);
    if (action === "created") return t("dash.logCreated", { role: roleName });
    if (action === "deleted") return t("dash.logDeleted", { role: roleName });
    return t("dash.logUpdated", { role: roleName });
  };

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.recentActivity")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.activityHint")}
        </span>
      </div>

      {loading && <ListSkeleton rows={4} />}
      {!loading && total === 0 && (
        <p className="tt-muted" style={{ fontSize: 13 }}>
          {t("dash.logsEmpty")}
        </p>
      )}

      {logs.map(l => (
        <div key={l.id} className="tt-log-row">
          <span className="tt-staff-cell">
            <strong>{l.actor_email}</strong> {describe(l.action, l.target_role)}{" "}
            <span className="tt-muted">({l.target_email})</span>
          </span>
          <span className="tt-muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
            {new Date(l.created_at).toLocaleString([], {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      ))}

      {pages > 1 && (
        <div className="tt-log-pager">
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("dash.newer")}
          </button>
          <span className="tt-muted" style={{ fontSize: 13 }}>
            {t("dash.pageOf", { page, pages })}
          </span>
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t("dash.older")}
          </button>
        </div>
      )}
    </div>
  );
}
