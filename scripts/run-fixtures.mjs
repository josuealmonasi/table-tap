/**
 * Every pool of the run, so the runner can fingerprint shared rows after each
 * case: one refusal that wrongly writes a shared row also fails every later
 * case that borrows it, and the diagnosis must not depend on case order
 * (audit of #648).
 */
const pools = new Set();

/** Shared rows belong to one run. Borrowers cannot tear down another's rows. */
export function runFixtures() {
  const shared = new Map();
  /** A fixture's `fingerprint()` when it was created; keys without one are not tracked. */
  const baseline = new Map();
  /** The first case after which a shared row no longer matched its baseline. */
  const changedBy = new Map();
  /** Keys the running case borrowed. */
  let borrowed = new Set();
  const pool = {
    async acquire(key, create) {
      if (!shared.has(key)) {
        const pending = Promise.resolve().then(create).then(async fixture => {
          // A diagnosis aid only: a baseline that cannot be read leaves the
          // row untracked, never fails the setup.
          if (typeof fixture?.fingerprint === "function") {
            try { baseline.set(key, await fixture.fingerprint()); } catch { /* untracked */ }
          }
          return fixture;
        });
        shared.set(key, pending);
        // Failed setup cleans its own partial rows. Let a later case retry it.
        pending.catch(() => shared.delete(key));
      }
      borrowed.add(key);
      return { ...await shared.get(key), cleanup: async () => {} };
    },
    /** A new case starts: what it borrows is its own. */
    begin() { borrowed = new Set(); },
    /** After a case: name it as the changer of any shared row it left different. */
    async settle(caseName) {
      for (const key of borrowed) {
        if (changedBy.has(key) || !baseline.has(key) || !shared.has(key)) continue;
        try {
          const now = await (await shared.get(key)).fingerprint();
          if (now !== baseline.get(key)) changedBy.set(key, caseName);
        } catch {
          // An unreadable row says nothing about who changed it.
        }
      }
      borrowed = new Set();
    },
    /** Shared rows this case borrowed that an earlier case already changed. */
    inherited() {
      return [...borrowed].filter(key => changedBy.has(key)).map(key => ({ key, by: changedBy.get(key) }));
    },
    async cleanup(keys = [...shared.keys()]) {
      const fixtures = keys.filter(key => shared.has(key)).map(key => [key, shared.get(key)]);
      // Try every sitting even if one deletion fails; one failed cleanup must
      // not leave all the other cases' rows on the floor.
      const results = await Promise.allSettled(fixtures.map(async ([key, pending]) => {
        await (await pending).cleanup();
        // Keep a failed group deletion reachable for the run's final cleanup.
        if (shared.get(key) === pending) {
          shared.delete(key); baseline.delete(key); changedBy.delete(key);
        }
      }));
      const failed = results.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
  pools.add(pool);
  return pool;
}

export function sharedRunFixtures(owner) {
  return owner.readOnlyFixtures ??= runFixtures();
}

/** Called by the runner before each case. */
export function beginSharedCase() {
  for (const pool of pools) pool.begin();
}

/** Called by the runner after each case, whatever its outcome. */
export async function settleSharedCase(caseName) {
  for (const pool of pools) await pool.settle(caseName);
}

/**
 * For a failing case: " (shared row … was already changed by case "…")", or ""
 * when every shared row it borrowed was still as created. Names the FIRST case
 * that changed the row, which is where to look.
 */
export function inheritedChange() {
  const found = [...pools].flatMap(pool => pool.inherited());
  return found.length ? ` (shared fixture ${found.map(f => `${f.key} was already changed by "${f.by}"`).join("; ")})` : "";
}
