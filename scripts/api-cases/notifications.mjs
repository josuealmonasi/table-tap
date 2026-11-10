

export function notificationsCases() {
  return [
    // ── the floor ────────────────────────────────────────────────────────
    { name: "GET  /api/badges", as: "waiter", method: "GET", path: "/api/badges", expect: [200] },
    // The bell. A manager may read it and mark it read; that the floor and the
    // kitchen are refused is checked by `pnpm roles`, which owns the question
    // of who may call what.
    { name: "GET  /api/notifications", as: "manager", method: "GET",
      path: "/api/notifications", expect: [200],
      check: d => Array.isArray(d.notifications) || "did not answer with a list",
      save: d => ({ notificationIds: d.notifications.filter(n => !n.read_at).map(n => n.id) }) },
    { name: "POST /api/notifications (shown read)", as: "manager", method: "POST",
      path: "/api/notifications", body: (_fx, saved) => ({ all: true, ids: saved.notificationIds }), expect: [200] },
  ];
}
