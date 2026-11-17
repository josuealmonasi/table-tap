// Run each probe separately: one connection failure must fail the whole gate.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PROBES = ["probe-money-behavior.mjs", "probe-held-resolve.mjs", "probe-coverage-no-write.mjs"];

function run(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("scripts", name)], { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => resolve({ code }));
  });
}

export async function runProbes(probes = PROBES, execute = run) {
  if (!probes.length) return false;
  let passed = true;
  for (const probe of probes) {
    try {
      const result = await execute(probe);
      if (result.code !== 0) passed = false;
    } catch (error) {
      console.error(`FAIL ${probe}: ${error.message}`);
      passed = false;
    }
  }
  return passed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--prod") || process.env.NODE_ENV === "production") {
    console.error("refusing to probe production");
    process.exitCode = 1;
  } else process.exitCode = await runProbes() ? 0 : 1;
}
