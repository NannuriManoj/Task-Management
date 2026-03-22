import { dbPool } from "../../config/databases.js";

// Find user by email
export async function findUserByEmail(email: string) {
    const { rows } = await dbPool.query(
        "SELECT id, name, email, password_hash FROM users WHERE email = $1",
        [email]
    );
    return rows[0];
}

// Create user
export async function createUser(name: string, email: string, passwordHash: string) {
    const { rows } = await dbPool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, created_at`,
        [name, email, passwordHash]
    );
    return rows[0];
}

// Get user by ID
export async function getUserById(userId: string) {
    const { rows } = await dbPool.query(
        "SELECT id, name, email FROM users WHERE id = $1",
        [userId]
    );
    return rows[0];
}