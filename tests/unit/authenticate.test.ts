/**
 * tests/unit/authenticate.test.ts  — Unit tests
 *
 * Tests the authenticate middleware in isolation using a minimal Fastify
 * instance with @fastify/jwt registered. No database required.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import  type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// Inline a minimal version of the authenticate preHandler so the test
// doesn't depend on the module importing `env` (which requires all env vars).
// If your authenticate.ts is self-contained, you can import it directly instead.
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();

  await app.register(fastifyJwt, {
    secret: "test-secret-that-is-at-least-32-characters-long",
  });

  // Replicate the authenticate preHandler
  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });

  // A protected test route
  app.get(
    "/protected",
    { preHandler: [(app as any).authenticate] },
    async (request) => {
      return { user: (request as any).user };
    }
  );

  return app;
}

describe("authenticate middleware", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await app.inject({ method: "GET", url: "/protected" });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 401 for a malformed token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { Authorization: "Bearer this.is.garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for a token signed with a different secret", async () => {
    // Sign a token with a DIFFERENT secret
    const wrongApp = Fastify();
    await wrongApp.register(fastifyJwt, {
      secret: "wrong-secret-that-is-at-least-32-characters-long!",
    });
    const badToken = wrongApp.jwt.sign({ sub: "user-id", email: "x@x.com" });
    await wrongApp.close();

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { Authorization: `Bearer ${badToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows through a valid JWT and populates request.user", async () => {
    const token = app.jwt.sign({
      sub: "550e8400-e29b-41d4-a716-446655440000",
      email: "alice@example.com",
    });

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.sub).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(body.user.email).toBe("alice@example.com");
  });

  it("returns 401 for an expired token", async () => {
    // Sign with expiresIn in the past
    const token = app.jwt.sign(
      { sub: "some-id", email: "x@x.com" },
      { expiresIn: -1 } // expired 1 second ago
    );

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });
});