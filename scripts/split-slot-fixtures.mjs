import { splitSlotFixture } from "./split-slots-fixture.mjs";
import { runFixtures } from "./run-fixtures.mjs";

/** One run owns shared read-only sittings; every writer still owns its own. */
export function splitSlotFixtures(admin, restaurantId) {
  const shared = runFixtures();
  return {
    async acquire(options = {}, readOnly = false) {
      if (!readOnly) return splitSlotFixture(admin, restaurantId, options);
      const { currency = "MXN", totalCents = 11000, shares = 2, start = true } = options;
      const key = JSON.stringify([currency, totalCents, shares, start]);
      return shared.acquire(key, () => splitSlotFixture(admin, restaurantId, options));
    },
    async cleanup() {
      await shared.cleanup();
    },
  };
}
