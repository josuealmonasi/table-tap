import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // The gate scripts state each verdict as `passed ? ok(...) : bad(...)`.
  // That is a statement on purpose, and the only expression they may leave
  // unused; everything else about them is linted like the app.
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-expressions": ["warn", { allowTernary: true }],
      // `const { updated_at: _changes, ...rest } = row` is how a key is left out.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
];

export default eslintConfig;
