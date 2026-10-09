// ============================================================================
// `pnpm gate` — the gates this change needs, one at a time, against your own
// dev server. `pnpm gate --all` is the whole gate.
//
// gate-plan.mjs decides what runs and on which pages and routes. This runs it:
// one gate after another (two browser gates at once kill the dev server), each
// one's output in its own file, its own exit code — never a pipe's — in the
// summary.
//
// A run is only worth its summary if it tested what you think it tested, so:
//   - the server on DEV_URL must be running THIS checkout. Another agent's
//     `next dev` on the same port answered a whole run once; a gate it would
//     have checked is marked and fails instead.
//   - the code must not move under it. HEAD and the working tree are
//     fingerprinted before and after every gate, and a gate that ran across a
//     change is marked and fails: it tested neither version.
//   - a gate that prints nothing for GATE_STALL_MIN minutes (6) has hung. It
//     is stopped and run once more; a second stall fails it. A gate that
//     writes and was stopped mid-case never ran its teardown, and what it left
//     fails the rerun over data — a spent visit card, a coupon code taken — so
//     the demo data is seeded again (`db.mjs mock`) before the rerun.
//
// Flags: --all, --base <ref> (origin/main), --committed (ignore uncommitted
// work), --plan (print the plan and stop), --only a,b (just these, unscoped).
// ============================================================================
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORDER, plan } from "./gate-plan.mjs";
import { DEV_URL } from "./dev-url.mjs";

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => (flag(name) ? args[args.indexOf(name) + 1] : null);
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const STALL_MS = Number(process.env.GATE_STALL_MIN ?? 6) * 60_000;
const SERVERLESS = new Set(["tsc", "lint", "test"]);
const WRITERS = new Set(["api", "rls", "attack", "promises"]);

const COMMANDS = {
  mock: ["node", ["scripts/db.mjs", "mock"]],
  tsc: ["npx", ["tsc", "--noEmit", "-p", "."]],
  lint: ["pnpm", ["lint"]],
  test: ["npx", ["vitest", "run"]],
};

const sh = (cmd, ...a) => { try { return execFileSync(cmd, a, { encoding: "utf8" }).trim(); } catch { return ""; } };

/** HEAD plus every uncommitted change: what the gates are testing. */
function fingerprint() {
  const head = sh("git", "rev-parse", "HEAD");
  const diff = sh("git", "diff", "HEAD");
  const untracked = sh("git", "ls-files", "--others", "--exclude-standard");
  return { head, hash: createHash("sha1").update(head + diff + untracked).digest("hex") };
}

/**
 * Whether the server on DEV_URL runs this checkout: the listener, or one of
 * the processes that started it, works in this folder or names it.
 */
function serverIsOurs() {
  const port = new URL(DEV_URL).port || "80";
  let pid = sh("lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN").split("\n")[0];
  if (!pid) return { ok: false, why: `nothing listens on port ${port}` };
  const seen = [];
  for (let i = 0; pid && pid !== "1" && i < 6; i++) {
    const cwd = sh("lsof", "-a", "-p", pid, "-d", "cwd", "-Fn").split("\n").find(l => l.startsWith("n"))?.slice(1);
    const command = sh("ps", "-o", "command=", "-p", pid);
    if (cwd === ROOT || command.split(/\s+/).includes(ROOT)) return { ok: true };
    seen.push(cwd);
    pid = sh("ps", "-o", "ppid=", "-p", pid).trim();
  }
  return { ok: false, why: `port ${port} is served from ${seen.filter(Boolean).at(-1) ?? "somewhere else"}, not ${ROOT}` };
}

// The gate running now. It is started in a group of its own so a stall can
// stop all of it, which also means stopping this script does not stop it —
// so this script takes it down on the way out.
let current = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (current) try { process.kill(-current.pid, "SIGTERM"); } catch { /* already gone */ }
    process.exit(1);
  });
}

/** One gate, its output to a file; stopped if it falls silent. */
function runOnce(gate, env, file) {
  const [cmd, cmdArgs] = COMMANDS[gate] ?? ["pnpm", [gate]];
  return new Promise(resolve => {
    const out = fs.openSync(file, "w");
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    current = child;
    let last = Date.now();
    const write = chunk => { last = Date.now(); fs.writeSync(out, chunk); };
    child.stdout.on("data", write);
    child.stderr.on("data", write);
    let stalled = false;
    const watch = setInterval(() => {
      if (Date.now() - last < STALL_MS) return;
      stalled = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    }, 10_000);
    child.on("close", code => {
      current = null;
      clearInterval(watch);
      fs.closeSync(out);
      resolve({ code: code ?? 1, stalled });
    });
  });
}

const p = flag("--only")
  ? { files: [], gates: value("--only").split(",").map(name => ({ name, run: true, why: "asked for", scope: {} })) }
  : plan({ base: value("--base") ?? "origin/main", all: flag("--all"), committedOnly: flag("--committed") });
const unknown = p.gates.filter(g => !ORDER.includes(g.name));
if (unknown.length) {
  console.log(`\n  No gate called ${unknown.map(g => g.name).join(", ")}. The gates: ${ORDER.join(", ")}\n`);
  process.exit(1);
}

console.log(`\nGate — ${p.files.length} changed file(s) against ${value("--base") ?? "origin/main"}; server ${DEV_URL}\n`);
for (const g of p.gates) {
  const scope = Object.entries(g.scope).map(([k, v]) => `${k.replace("GATE_", "").toLowerCase()}: ${v.length}`).join(", ");
  console.log(`  ${g.run ? "run " : "skip"}  ${g.name.padEnd(9)} ${g.why}${scope ? ` (${scope})` : ""}`);
}
if (flag("--plan")) process.exit(0);
const LOGS = fs.mkdtempSync(path.join(os.tmpdir(), "tabletap-gate-"));
console.log(`\n  Each gate's output goes to ${LOGS}\n`);

const start = fingerprint();
const results = [];
for (const g of p.gates.filter(g => g.run)) {
  const file = path.join(LOGS, `${g.name}.txt`);
  if (!SERVERLESS.has(g.name)) {
    const server = serverIsOurs();
    if (!server.ok) {
      results.push({ name: g.name, verdict: `NOT RUN — ${server.why}` });
      console.log(`  FAIL  ${g.name.padEnd(9)} not run: ${server.why}`);
      continue;
    }
  }
  const env = Object.fromEntries(Object.entries(g.scope).map(([k, v]) => [k, JSON.stringify(v)]));
  const began = Date.now();
  let run = await runOnce(g.name, env, file);
  let note = "";
  if (run.stalled) {
    note = `fell silent for ${STALL_MS / 60_000} min, stopped and run again`;
    if (WRITERS.has(g.name)) {
      const reseed = await runOnce("mock", {}, path.join(LOGS, `${g.name}-reseed.txt`));
      note += reseed.code === 0 ? " on fresh demo data" : " (reseeding the demo data failed)";
    }
    run = await runOnce(g.name, env, file);
    if (run.stalled) note = "fell silent twice";
  }
  const minutes = ((Date.now() - began) / 60_000).toFixed(1);
  const now = fingerprint();
  const moved = now.hash !== start.hash;
  const passed = run.code === 0 && !run.stalled && !moved;
  // What a scoped gate says it covered, so "ok" never hides "checked nothing".
  const covered = [...fs.readFileSync(file, "utf8").matchAll(/scope: \S+ checked (\d+) (page visit\(s\)|case\(s\))/g)].map(m => `${m[1]} ${m[2]}`).join(", ");
  const why = [moved ? `the code changed while it ran (HEAD ${now.head.slice(0, 7)})` : run.stalled ? note : run.code ? `exit ${run.code}` : note, covered && `checked ${covered}`].filter(Boolean).join("; ");
  results.push({ name: g.name, verdict: passed ? "ok" : why, passed });
  console.log(`  ${passed ? "ok  " : "FAIL"}  ${g.name.padEnd(9)} ${minutes} min${why ? ` — ${why}` : ""}${passed ? "" : `  → ${file}`}`);
}

const failed = results.filter(r => !r.passed);
console.log(failed.length ? `\n${failed.length} gate(s) failed: ${failed.map(r => r.name).join(", ")}.\n` : "\nEvery gate this change needs passed.\n");
process.exit(failed.length ? 1 : 0);
