import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";

// Build the retired values so this guard does not publish them again itself.
const retired = ["demo", "test"].map(prefix => `${prefix}${123}`);
const lockfiles = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"]);

function violations(root: string): string[] {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  return files.flatMap(file => {
    if (lockfiles.has(file.split("/").at(-1)!)) return [];
    const content = readFileSync(join(root, file), "utf8");
    const fake = file.split("/").includes("__tests__");
    const literalLines = new Set<number>();
    const assignment = /(?:(?<![\w"'])\b(?:\w*_)?password\b|[{,]\s*["'](?:\w*_)?password["'])\s*[:=]\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gi;
    for (const match of content.matchAll(assignment)) {
      const runtimeTemplate = match[1] === "`" && match[2].includes("${");
      if (match[2] && !runtimeTemplate) literalLines.add(content.slice(0, match.index).split("\n").length - 1);
    }
    return content.split("\n").flatMap((line, index) => {
      const old = retired.some(value => line.includes(value));
      const env = /^\s*(?:export\s+)?\w*PASSWORD\s*=\s*([^#\r\n]+)/i.exec(line);
      const filledEnv = env && !["", '""', "''"].includes(env[1].trim());
      return old || (!fake && (literalLines.has(index) || filledEnv)) ? [`${file}:${index + 1}: committed login password`] : [];
    });
  });
}

it("keeps login passwords out of every tracked file, including docs and test fakes", () => {
  expect(violations(process.cwd())).toEqual([]);
});

const copies: string[] = [];
afterEach(() => { for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true }); });

function copyWith(file: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), "tabletap-login-password-"));
  copies.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  copyFileSync("AGENTS.md", join(root, "AGENTS.md"));
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
  execFileSync("git", ["add", "AGENTS.md", file], { cwd: root });
  return root;
}

it.each([
  ["README.md", retired[0]],
  ["docs/logins.md", retired[1]],
  ["src/lib/__tests__/fake.spec.ts", retired[0]],
  ["scripts/seed.mjs", 'const password = "planted-violation";'],
  ["scripts/seed.mjs", "const user = { password: 'planted-violation' };"],
  ["scripts/seed.mjs", 'const user = { "password": "planted-violation" };'],
  ["scripts/seed.mjs", 'const DEMO_PASSWORD = "planted-violation";'],
  ["scripts/seed.mjs", "const password = `planted-violation`;"],
  ["scripts/seed.mjs", 'const password =\n  "planted-violation";'],
  ["scripts/seed.mjs", 'const password = "a secret with an apostrophe\'s mark";'],
  ["scripts/seed.mjs", 'const password = "literal-${notAnEnvironmentValue}";'],
  [".env.example", "TEST_PASSWORD=planted-violation"],
])("catches a violation planted in a temporary copy of %s", (file, content) => {
  expect(violations(copyWith(file, content))).toEqual([`${file}:1: committed login password`]);
});

it("allows test fakes, empty env placeholders and runtime values", () => {
  const root = copyWith("src/lib/__tests__/fake.spec.ts", 'const password = "unit-test-only";');
  expect(violations(root)).toEqual([]);
  const env = copyWith(".env.example", "DEMO_PASSWORD=\nTEST_PASSWORD=\n");
  expect(violations(env)).toEqual([]);
  const script = copyWith("scripts/seed.mjs", 'const password = process.env.TEST_PASSWORD;');
  writeFileSync(join(script, "scripts/seed.mjs"), 'const password = process.env.TEST_PASSWORD;\nconst key = custom ? "SMOKE_PASSWORD" : "DEMO_PASSWORD";');
  writeFileSync(join(script, "untracked.mjs"), retired[0]);
  expect(violations(script)).toEqual([]);
  expect(violations(copyWith("pnpm-lock.yaml", retired[0]))).toEqual([]);
});
