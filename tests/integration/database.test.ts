/**
 * tests/integration/database.test.ts  — Integration tests
 *
 * Verifies the connection pool connects, runs queries, and that
 * the health check route reports the DB as reachable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../src/app.js";
import { dbPool } from "../../src/config/databases.js";

describe("Database connection", () => {
  it("can execute a simple query", async () => {
    const { rows } = await dbPool.query("SELECT 1 + 1 AS result");
    expect(rows[0].result).toBe(2);
  });

  it("has the users table in place (migrations ran)", async () => {
    const { rows } = await dbPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("email");
    expect(columns).toContain("password_hash");
    expect(columns).toContain("name");
    expect(columns).toContain("created_at");
  });
});

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await dbPool.end();
  });

  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });
});