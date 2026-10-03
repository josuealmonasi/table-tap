// ============================================================================
// What a signed-in person can do to a refund due that they should not.
//
// A refund due is a diner's money waiting to go back to their card. Judged by
// effect, like the rest of `pnpm attack`: the row is read with the secret key
// after each attempt, because a refusal that marked it refunded anyway would
// tell the restaurant a diner was paid back who never was.
//
//   - the kitchen and a waiter: refused, the row still owed
//   - nobody signed in: refused, the row still owed
//   - a manager naming another restaurant's refund: refused, theirs untouched
//
// Everything planted here is removed again, whatever happens in between.
// ============================================================================

const MARK = "attack-refund";

/** Only the owner or a manager of the restaurant it belongs to gives one back. */
export async function attackRefunds({ admin, post, who, home, neighbour, ok, bad }) {
  // Leftovers from a run that did not finish, before planting more.
  await admin.from("refunds_due").delete().eq("table_label", MARK);

  const plant = async restaurantId => {
    const { data, error } = await admin.from("refunds_due").insert({
      restaurant_id: restaurantId,
      stripe_payment_intent: `pi_${MARK}_${crypto.randomUUID()}`,
      amount: 40,
      table_label: MARK,
    }).select("id").single();
    if (error) throw new Error(`could not plant a refund due: ${error.message}`);
    return data.id;
  };
  const stillOwed = async id => {
    const { data } = await admin.from("refunds_due").select("refunded_at").eq("id", id).maybeSingle();
    return Boolean(data) && data.refunded_at === null;
  };

  try {
    const ours = await plant(home.id);
    const theirs = await plant(neighbour.id);

    for (const [role, cookie] of [["kitchen", who.kitchen], ["waiter", who.waiter], ["nobody signed in", null]]) {
      const res = await post("/api/refunds-due", { id: ours }, cookie);
      res.status === 403 && (await stillOwed(ours))
        ? ok(`${role} cannot give back a refund due`)
        : bad(`${role} reached a refund due: ${res.status}, still owed: ${await stillOwed(ours)}`);
    }

    const res = await post("/api/refunds-due", { id: theirs }, who.manager);
    res.status === 404 && (await stillOwed(theirs))
      ? ok("a manager cannot give back another restaurant's refund due")
      : bad(`a manager reached another restaurant's refund due: ${res.status}, still owed: ${await stillOwed(theirs)}`);
  } finally {
    await admin.from("refunds_due").delete().eq("table_label", MARK);
  }
}
