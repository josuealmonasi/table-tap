import { tableJoinScenario } from "./table-join-scenario.mjs";
import { checkTableJoin } from "./check-table-join.mjs";

/** The saved QR, forged diner id, pending phone, rejection and old party, with cleanup. */
export async function attackTableJoin({ admin, base, who, home, ok, bad }) {
  let scenario;
  try {
    scenario = await tableJoinScenario({ admin, base, restaurantId: home.id });
    await checkTableJoin(scenario, who);
    ok("new phones need approval; an old party cannot read the next bill and can still pay its own");
  } catch (error) { bad(`table admission: ${error.message}`); }
  finally { if (scenario) await scenario.cleanup(); }
}
