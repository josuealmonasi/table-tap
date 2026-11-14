/** Shared rows belong to one run. Borrowers cannot tear down another's rows. */
export function runFixtures() {
  const shared = new Map();
  return {
    async acquire(key, create) {
      if (!shared.has(key)) {
        const pending = Promise.resolve().then(create);
        shared.set(key, pending);
        // Failed setup cleans its own partial rows. Let a later case retry it.
        pending.catch(() => shared.delete(key));
      }
      return { ...await shared.get(key), cleanup: async () => {} };
    },
    async cleanup(keys = [...shared.keys()]) {
      const fixtures = keys.filter(key => shared.has(key)).map(key => [key, shared.get(key)]);
      // Try every sitting even if one deletion fails; one failed cleanup must
      // not leave all the other cases' rows on the floor.
      const results = await Promise.allSettled(fixtures.map(async ([key, pending]) => {
        await (await pending).cleanup();
        // Keep a failed group deletion reachable for the run's final cleanup.
        if (shared.get(key) === pending) shared.delete(key);
      }));
      const failed = results.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}

export function sharedRunFixtures(owner) {
  return owner.readOnlyFixtures ??= runFixtures();
}
