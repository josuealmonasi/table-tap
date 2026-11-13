import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Load the same pure TypeScript modules as the app; no copied monetary formula.
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const result = { exports: {} };
  modules.set(file, result.exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(code, { exports: result.exports, require: name => {
    if (!name.startsWith(".")) throw new Error(`Unexpected tip helper dependency: ${name}`);
    return load(resolve(dirname(file), `${name}.ts`));
  } }, { filename: file });
  return result.exports;
}
export const { ordersTipBase, frozenTipPrincipal, splitTipBase, tipFromPercent } = load(resolve("src/lib/tip-base.ts"));
