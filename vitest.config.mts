import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Node by default; cache hook tests opt into jsdom to exercise React and SWR.
// No DB or real network. The `@/` alias mirrors tsconfig so imports resolve.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
