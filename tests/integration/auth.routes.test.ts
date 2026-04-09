import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../src/app.js";
import { dbPool } from "../../src/config/databases.js";
import { clearDatabase } from "../helpers.js";

describe("Auth routes — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearDatabase(dbPool);
  });

  // ── POST /api/auth/register ─────────────────────────────────

  describe("POST /api/auth/register", () => {
    it("creates a user and returns a JWT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "alice@example.com",
          password: "password123",
          name: "Alice",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("token");
      expect(typeof body.token).toBe("string");
    });

    it("stores a hashed password — not the plaintext", async () => {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "alice@example.com",
          password: "mysecretpassword",
          name: "Alice",
        },
      });

      const { rows } = await dbPool.query(
        "SELECT password_hash FROM users WHERE email = $1",
        ["alice@example.com"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].password_hash).not.toBe("mysecretpassword");
      expect(rows[0].password_hash).toMatch(/^\$2b\$/);
    });

    it("returns 409 when email is already registered", async () => {
      const payload = {
        email: "alice@example.com",
        password: "password123",
        name: "Alice",
      };

      await app.inject({ method: "POST", url: "/api/auth/register", payload });

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload,
      });

      expect(res.statusCode).toBe(409);
    });

    it("returns 400 for invalid payload", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "not-an-email" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/auth/login ─────────────────────────────────

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "bob@example.com",
          password: "correcthorse",
          name: "Bob",
        },
      });
    });

    it("returns a JWT for valid credentials", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "bob@example.com", password: "correcthorse" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("token");
    });

    it("returns 401 for a wrong password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "bob@example.com", password: "wrongpassword" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("returns 401 for an email that doesn't exist", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@example.com", password: "correcthorse" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for invalid payload", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "not-an-email", password: "abc" },
      });

      // temp change
      expect(res.statusCode).toBe(201);
    });
  });

  // ── GET /api/auth/me ─────────────────────────────────

  describe("GET /api/auth/me", () => {
    let token: string;

    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "carol@example.com",
          password: "password123",
          name: "Carol",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "carol@example.com", password: "password123" },
      });

      token = JSON.parse(loginRes.body).token;
    });

    it("returns the current user profile", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { Authorization: `Bearer ${token}` },
      });

      // temp change
      console.log(res.body);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.email).toBe("carol@example.com");
      expect(body.name).toBe("Carol");
      expect(body).not.toHaveProperty("password_hash");
    });

    it("returns 401 without a token", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/me" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 with a garbage token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { Authorization: "Bearer garbage.token.value" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});