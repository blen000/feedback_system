import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // the real package throws outside a Next.js server bundle
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one database: run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: "test" },
  },
});
