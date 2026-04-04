/**
 * tests/e2e/auth.e2e.test.ts  — End-to-End tests
 *
 * These tests hit a REAL running HTTP server (not app.inject) over the
 * network with `fetch`. They test the full stack from TCP socket to DB.
 *
 * Run separately:
 *   npx vitest run --config vitest.config.e2e.ts
 *
 * Prerequisites:
 *   - Server running: npm run dev (or npm run start) pointing at task_api_test
 *   - E2E_BASE_URL env var set (defaults to http://localhost:3001)
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Pool } from "pg";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

// We need direct DB access to clean state between tests
const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function api(
  path: string,
  options: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function clearUsers() {
  await dbPool.query("DELETE FROM tasks WHERE TRUE");
  await dbPool.query("DELETE FROM project_members WHERE TRUE");
  await dbPool.query("DELETE FROM projects WHERE TRUE");
  await dbPool.query("DELETE FROM users WHERE TRUE");
}

describe("E2E — Auth flow", () => {
  beforeEach(async () => {
    await clearUsers();
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  it("GET /health → 200", async () => {
    const { status, body } = await api("/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  // ── Full register → login → me flow ───────────────────────────────────────

  it("registers, logs in, and fetches profile", async () => {
    // 1. Register
    const register = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "dave@example.com",
        password: "password123",
        name: "Dave",
      }),
    });
    expect(register.status).toBe(201);
    expect(register.body).toHaveProperty("token");

    // 2. Login
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "dave@example.com",
        password: "password123",
      }),
    });
    expect(login.status).toBe(200);
    const token: string = login.body.token;
    expect(typeof token).toBe("string");

    // 3. Fetch profile
    const me = await api("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("dave@example.com");
    expect(me.body.name).toBe("Dave");
    expect(me.body).not.toHaveProperty("password_hash");
  });

  // ── Duplicate registration ─────────────────────────────────────────────────

  it("returns 409 when registering the same email twice", async () => {
    const payload = JSON.stringify({
      email: "eve@example.com",
      password: "password123",
      name: "Eve",
    });

    const first = await api("/auth/register", { method: "POST", body: payload });
    expect(first.status).toBe(201);

    const second = await api("/auth/register", {
      method: "POST",
      body: payload,
    });
    expect(second.status).toBe(409);
  });

  // ── Wrong credentials ──────────────────────────────────────────────────────

  it("returns 401 for incorrect password", async () => {
    await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "frank@example.com",
        password: "correctpassword",
        name: "Frank",
      }),
    });

    const { status } = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "frank@example.com",
        password: "wrongpassword",
      }),
    });
    expect(status).toBe(401);
  });

  // ── Protected route without token ─────────────────────────────────────────

  it("returns 401 on GET /auth/me without Authorization header", async () => {
    const { status } = await api("/auth/me");
    expect(status).toBe(401);
  });

  // ── Validation errors returned as 400 ─────────────────────────────────────

  it("returns 400 when registering with a bad email", async () => {
    const { status } = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "not-an-email",
        password: "password123",
        name: "Grace",
      }),
    });
    expect(status).toBe(400);
  });
});