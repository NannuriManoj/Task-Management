import { defineConfig } from "vitest/config";
 
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/db/migrate.ts", "src/types/**"],
    },
    // Run unit and integration tests together; e2e tests are opt-in
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    setupFiles: ["tests/setup.ts"],
  },
});
 


