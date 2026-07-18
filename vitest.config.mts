import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests run in a plain Node environment against pure functions — no jsdom,
// no DB, no network. The `@/` alias mirrors tsconfig so imports resolve.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
