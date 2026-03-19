import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbPool } from '../config/databases.js';

// ESM modules do not have __dirname and __filename, so we need to create them
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the directory where migration SQL files are located
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Function to run database migrations
const runMigrations = async () => {
    // Connect to the database using the connection pool
    const client = await dbPool.connect();

    // Ensure the _migrations table exists to track applied migrations
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        
        // Fetch the list of already applied migrations from the database
        const { rows } = await client.query<{ filename: string }>(
            `SELECT filename FROM _migrations`
        );

        // Create a set of applied migration filenames for quick lookup
        const appliedMigrations = new Set(rows.map(row => row.filename));

        // Read all SQL files from the migrations directory, filter and sort them
        const files = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter(file => file.endsWith('.sql'))
            .sort();

        let appliedCount = 0;

        // Loop through each migration file and apply it if it hasn't been applied yet
        for (const file of files) {
            if (appliedMigrations.has(file)) {
                console.log(`Skipping already applied migration: ${file}`);
                continue;
            }

        // Read the SQL content from the migration file
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
        
        // Start a transaction for applying the migration
        await client.query('BEGIN');
        try {
            await client.query(sql);
            await client.query(
                `INSERT INTO _migrations (filename) VALUES ($1)`,
                [file]
            );
            await client.query('COMMIT');
            console.log(`Applied migration: ${file}`);
            appliedCount++;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`Error applying migration ${file}:`, error);
            throw new Error(`Failed to apply migration: ${file}`); // Rethrow the error to stop further migrations
        }
    }

    // Log the number of applied migrations or indicate that there were no new migrations to apply
    console.log(appliedCount > 0 ? `Successfully applied ${appliedCount} new migration(s).` : 'No new migrations to apply.');

    } catch (error) {
        console.error('Error running migrations:', error);
        process.exit(1);
    } finally {
        client.release();
        await dbPool.end(); // Close the database pool after running migrations
    }
}

runMigrations();