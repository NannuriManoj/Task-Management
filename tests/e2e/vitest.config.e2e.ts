import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    include: ["tests/e2e/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15_000,
  },
});