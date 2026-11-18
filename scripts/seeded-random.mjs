/**
 * A demo seed that can be replayed. With SEED set, Math.random is replaced by
 * a seeded generator (mulberry32) for the whole seeding process, so every
 * random choice — which dishes are popular or sold out, which carry extras,
 * which orders are cancelled — comes out the same for the same seed. Unset,
 * nothing changes: local seeds stay random. CI sets a fixed SEED and prints it,
 * so a layout failure on GitHub can be replayed here with the same menu (the
 * dish-detail 3.6px case could not be reproduced without it).
 */
export function seededRandom(seed) {
  let a = hashSeed(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Installs the seeded generator when SEED is set. Returns the seed used, or null. */
export function installSeed(env = process.env) {
  const seed = env.SEED?.trim();
  if (!seed) return null;
  Math.random = seededRandom(seed);
  console.log(`  demo seed: SEED=${seed} (replay locally with the same value)`);
  return seed;
}
