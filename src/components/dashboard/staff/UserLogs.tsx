"use client";

import { useUserLogs } from "@/hooks/useUserLogs";

interface UserLogsProps {
  restaurantId: string;
}

/** "manager1@… created a new kitchen user at 12 Jul, 10:31" */
function describe(action: string, role: string): string {
  if (action === "created") return `created a new ${role} user`;
  if (action === "deleted") return `deleted a ${role} user`;
  return `updated a user to ${role}`;
}

/** Owner-only activity log: who created/updated/deleted which login. */
export default function UserLogs({ restaurantId }: UserLogsProps) {
  const { logs, loading, page, pages, total, setPage } = useUserLogs(restaurantId);

  return (
    <div className="tt-section" style={{ maxWidth: 720, marginTop: 16 }}>
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>Recent activity</h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          Every change to logins and roles, newest first
        </span>
      </div>

      {loading && <p className="tt-muted" style={{ fontSize: 13 }}>Loading…</p>}
      {!loading && total === 0 && (
        <p className="tt-muted" style={{ fontSize: 13 }}>
          Nothing yet — team changes will show up here.
        </p>
      )}

      {logs.map((l) => (
        <div key={l.id} className="tt-log-row">
          <span className="tt-staff-cell">
            <strong>{l.actor_email}</strong> {describe(l.action, l.target_role)}{" "}
            <span className="tt-muted">({l.target_email})</span>
          </span>
          <span className="tt-muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
            {new Date(l.created_at).toLocaleString([], {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
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
            ← Newer
          </button>
          <span className="tt-muted" style={{ fontSize: 13 }}>
            Page {page} of {pages}
          </span>
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}
