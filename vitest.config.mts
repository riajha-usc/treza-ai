import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30_000,
    // Each test builds a fresh embedded Postgres in its setup hook, which can
    // exceed the 10 second default when every file runs in parallel.
    hookTimeout: 60_000,
  },
});
