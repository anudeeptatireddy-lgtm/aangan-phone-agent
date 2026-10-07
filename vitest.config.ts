import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 90_000 }, // PGlite boots a real Postgres: slow under parallel load
});
