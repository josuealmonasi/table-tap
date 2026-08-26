// ============================================================================
// TableTap — arrancar el servidor de desarrollo desde cero.
//
//   pnpm dev:fresh
//
// Tres problemas de una tarde larga, en un comando:
//
//   - el servidor se infla con las horas y se cae a media revisión;
//   - matar `next-server` no basta: el `pnpm dev` que lo lanzó lo revive, y el
//     puerto 3000 vuelve a estar ocupado un segundo después;
//   - `.next` guarda compilaciones viejas, así que una página puede servirse
//     con el código de hace tres merges y parecer un bug que no existe.
//
// Sólo mata lo que es de este proyecto. Si el 3000 lo tiene otra cosa, lo dice
// y se detiene en vez de matar algo que no era suyo.
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
 * Si un proceso es de este proyecto: tiene archivos suyos abiertos.
 *
 * Mirar el cwd no sirve — el servidor puede haberse lanzado desde el
 * directorio de arriba y seguir siendo el nuestro, que es justo lo que pasa
 * cuando lo arranca el panel de vista previa. Lo que no miente es qué archivos
 * tiene abiertos: su propio .next, sus propios node_modules.
 */
const belongsHere = pid => sh("lsof", ["-p", String(pid)]).includes(here);

const parentOf = pid => sh("ps", ["-o", "ppid=", "-p", String(pid)]).trim();
const commandOf = pid => sh("ps", ["-o", "command=", "-p", String(pid)]).trim();

/** Quién escucha en el puerto, y toda su ascendencia hasta el `pnpm dev`. */
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
      // El árbol de Next: next-server ← next dev ← pnpm dev.
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
      "  No es de este proyecto, así que no lo toco. Ciérralo y vuelve a intentar.\n",
  );
  process.exit(1);
}

if (tree.length > 0 && !tree.some(belongsHere)) {
  console.error(
    `\n  El servidor del puerto ${PORT} no tiene archivos de este proyecto abiertos:\n` +
      `    ${commandOf(tree[0]).slice(0, 100)}\n\n` +
      "  Parece de otro sitio, así que no lo toco. Ciérralo y vuelve a intentar.\n",
  );
  process.exit(1);
}

if (tree.length > 0) {
  // El padre primero: matar sólo al hijo hace que el padre lo resucite.
  for (const pid of tree.reverse()) sh("kill", ["-9", pid]);
  console.log(`  Servidor anterior detenido (${tree.length} procesos).`);
}

rmSync(join(here, ".next"), { recursive: true, force: true });
console.log("  .next borrado — se recompila todo desde cero.");
console.log("  Arrancando…\n");

spawn("pnpm", ["dev"], { stdio: "inherit", cwd: here }).on("exit", code => {
  process.exit(code ?? 0);
});
