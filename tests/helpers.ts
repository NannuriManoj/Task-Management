/**
 * tests/helpers.ts
 *
 * Shared utilities used across integration and e2e tests.
 */
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";

// ─── Database helpers ─────────────────────────────────────────────────────────

/**
 * Wipes all user rows between tests so each test starts clean.
 * Order matters if FK constraints are active — tasks → projects → users.
 */
export async function clearDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    DELETE FROM tasks          WHERE TRUE;
    DELETE FROM project_members WHERE TRUE;
    DELETE FROM projects        WHERE TRUE;
    DELETE FROM users           WHERE TRUE;
  `);
}

/**
 * Insert a user directly into the database (bypasses bcrypt for speed).
 * Returns the full row.
 */
export async function seedUser(
  pool: Pool,
  overrides: Partial<{
    email: string;
    password_hash: string;
    name: string;
  }> = {}
) {
  const email = overrides.email ?? "test@example.com";
  const name = overrides.name ?? "Test User";
  // bcrypt hash of "password123" with saltRounds=10
  const password_hash =
    overrides.password_hash ??
    "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi."; // "password"

  const { rows } = await pool.query<{
    id: string;
    email: string;
    name: string;
    created_at: Date;
  }>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, created_at`,
    [email, password_hash, name]
  );
  return rows[0];
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** POST /auth/login and return the JWT token string. */
export async function loginUser(
  app: FastifyInstance,
  email = "test@example.com",
  password = "password"
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  const body = JSON.parse(res.body);
  if (!body.token) {
    throw new Error(
      `loginUser: expected token in response, got: ${res.body}`
    );
  }
  return body.token as string;
}

/** Build an Authorization header object from a token. */
export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}