

export function notificationsCases() {
  return [
    // ── the floor ────────────────────────────────────────────────────────
    { name: "GET  /api/badges", as: "waiter", method: "GET", path: "/api/badges", expect: [200] },
    // The bell. A manager may read it and mark it read; that the floor and the
    // kitchen are refused is checked by `pnpm roles`, which owns the question
    // of who may call what.
    { name: "GET  /api/notifications", as: "manager", method: "GET",
      path: "/api/notifications", expect: [200],
      check: d => Array.isArray(d.notifications) || "did not answer with a list" },
    { name: "POST /api/notifications (all read)", as: "manager", method: "POST",
      path: "/api/notifications", body: { all: true }, expect: [200] },
  ];
}
