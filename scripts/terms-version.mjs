// ============================================================================
// The terms version the app enforces, read from where the app defines it.
//
// The seed used to keep its own copy, "kept in step with src/lib/legal.ts by
// hand". It fell a month behind, so every seeded account was recorded as having
// accepted terms that had since changed and opened on the terms modal — and
// the demo restaurant recorded none at all. A sweep that may not write cannot
// click the modal away, so it measured every owner screen from underneath it.
// ============================================================================
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/legal.ts", import.meta.url), "utf8");
const found = /export const TERMS_VERSION = "([^"]+)"/.exec(source);
if (!found) throw new Error("cannot find TERMS_VERSION in src/lib/legal.ts");

export const TERMS_VERSION = found[1];
