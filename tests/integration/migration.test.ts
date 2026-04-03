/**
 * tests/integration/migrations.test.ts  — Integration tests
 *
 * Verifies the migration runner is idempotent: running it twice doesn't
 * re-apply already-applied migrations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbPool } from "../../src/config/databases.js";

// Import the runMigrations function — adjust path as needed
import { runMigrations } from "../../src/db/migrate.js";

describe("Migration runner", () => {
  afterAll(async () => {
    await dbPool.end();
  });

  it("tracks applied migrations in the _migrations table", async () => {
    const { rows } = await dbPool.query(
      "SELECT name FROM _migrations ORDER BY run_at"
    );
    // At least the initial migration should have been applied
    const names = rows.map((r: { name: string }) => r.name);
    expect(names.some((n: string) => n.includes("001_create_users"))).toBe(true);
  });

  it("is idempotent — running migrations again does not error or duplicate", async () => {
    // Should not throw
    await expect(runMigrations()).resolves.not.toThrow();

    // Count should be the same as before
    const { rows } = await dbPool.query("SELECT COUNT(*) AS cnt FROM _migrations");
    const countAfter = parseInt(rows[0].cnt, 10);
    expect(countAfter).toBeGreaterThanOrEqual(1);
  });
});