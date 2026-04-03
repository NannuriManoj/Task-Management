import { dbPool } from "../config/databases.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export async function runMigrations() {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        run_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(process.cwd(), "src/db/migrations");
    const files = fs.readdirSync(migrationsDir).sort();

    for (const file of files) {
      const { rows } = await client.query(
        "SELECT name FROM _migrations WHERE name = $1",
        [file]
      );

      if (rows.length === 0) {
        console.log(`Applying migration: ${file}`);

        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      }
    }

    await client.query("COMMIT");
    console.log("Migrations completed");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error running migrations:", err);
    throw err;
  } finally {
    client.release();
  }
}

// Only run when executed directly (npm run migrate / npm run migrate:test)
// NOT when imported by tests
const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js");

if (isMain) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}