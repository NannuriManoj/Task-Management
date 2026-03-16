import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

// Create a new PostgreSQL connection pool using the DATABASE_URL from environment variables
export const dbPool = new Pool({
    connectionString: env.DATABASE_URL
});

export async function checkDbConnection(): Promise<void> {
    const client = await dbPool.connect();
    try {
        // Simple query to check the connection
        await client.query('SELECT 1'); 
        console.log('Database connection successful');
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1); // Exit the process if the database connection fails
    } finally {
        client.release(); // Release the client back to the pool
    }
};