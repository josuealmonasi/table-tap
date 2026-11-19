/** Read-only cases; Claude runs them after folding/applying the proposal. */
export function disputeCases(fx) {
  return [
    { name: "GET /api/disputes/history (manager's own order)", as: "manager", method: "GET",
      path: `/api/disputes/history?order=${fx.unpaidOrder}`, expect: [200],
      check: answer => Array.isArray(answer[fx.unpaidOrder]) || "missing order dispute history" },
    ...["kitchen", "waiter", "cashier"].map(role => ({ name: `GET /api/disputes/history (${role} refused)`,
      as: role, method: "GET", path: "/api/disputes/history", expect: [403], expectError: /sin permiso|forbidden/i })),
  ];
}
