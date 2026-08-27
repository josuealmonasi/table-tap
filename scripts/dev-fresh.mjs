// ============================================================================
// TableTap — start the dev server from scratch.
//
//   pnpm dev:fresh
//
// Three problems from one long afternoon, in a single command:
//
//   - the server bloats over the hours and drops mid-run;
//   - killing `next-server` is not enough: the `pnpm dev` that launched it
//     revives it, and port 3000 is busy again a second later;
//   - `.next` keeps stale builds, so a page can be served with code from three
//     merges ago and look like a bug that does not exist.
//
// It only kills what belongs to this project. If something else holds 3000 it
// says so and stops, rather than killing something that was not its own.
// ============================================================================
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const PORT = 3000; // TableTap lo necesita: los QR y los webhooks apuntan ahí
const here = process.cwd();

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/**
 * Whether a process belongs to this project: it has our files open.
 *
 * Looking at the cwd is no use — the server may have been launched from the
 * directory above and still be ours, which is exactly what happens when the
 * preview pane starts it. What does not lie is which files it has open: its
 * own .next, its own node_modules.
 */
const belongsHere = pid => sh("lsof", ["-p", String(pid)]).includes(here);

const parentOf = pid => sh("ps", ["-o", "ppid=", "-p", String(pid)]).trim();
const commandOf = pid => sh("ps", ["-o", "command=", "-p", String(pid)]).trim();

/** Who is listening on the port, and its whole ancestry up to `pnpm dev`. */
function serverTree() {
  const listeners = sh("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"])
    .split("\n")
    .filter(Boolean);

  const tree = new Set();
  for (const pid of listeners) {
    let current = pid;
    for (let hop = 0; hop < 5 && current && current !== "1"; hop++) {
      const command = commandOf(current);
      if (!command) break;
      // The Next tree: next-server ← next dev ← pnpm dev.
      if (/next|pnpm/.test(command)) tree.add(current);
      current = parentOf(current);
    }
  }
  return { listeners, tree: [...tree] };
}

const { listeners, tree } = serverTree();

if (listeners.length > 0 && tree.length === 0) {
  console.error(
    `\n  El puerto ${PORT} lo tiene otra cosa (pid ${listeners.join(", ")}):\n` +
      `    ${commandOf(listeners[0]).slice(0, 100)}\n\n` +
      "  Not this project's, so I am leaving it alone. Close it and try again.\n",
  );
  process.exit(1);
}

if (tree.length > 0 && !tree.some(belongsHere)) {
  console.error(
    `\n  El servidor del puerto ${PORT} no tiene archivos de este proyecto abiertos:\n` +
      `    ${commandOf(tree[0]).slice(0, 100)}\n\n` +
      "  Looks like it belongs elsewhere, so I am leaving it alone. Close it and try again.\n",
  );
  process.exit(1);
}

if (tree.length > 0) {
  // The parent first: killing only the child has the parent resurrect it.
  for (const pid of tree.reverse()) sh("kill", ["-9", pid]);
  console.log(`  Previous server stopped (${tree.length} processes).`);
}

rmSync(join(here, ".next"), { recursive: true, force: true });
console.log("  .next cleared — everything recompiles from scratch.");
console.log("  Arrancando…\n");

spawn("pnpm", ["dev"], { stdio: "inherit", cwd: here }).on("exit", code => {
  process.exit(code ?? 0);
});
