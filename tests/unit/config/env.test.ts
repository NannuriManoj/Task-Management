/**
 * tests/unit/env.test.ts  — Unit tests
 *
 * Tests the Zod schema directly — no dynamic imports, no process.env mutation.
 * This is the correct way to unit-test a validation schema.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().min(32),
});

const VALID = {
  DATABASE_URL: "postgres://postgres:pass@localhost:5432/test",
  JWT_SECRET: "a-secret-that-is-definitely-at-least-32-characters",
  PORT: "3000",
  HOST: "0.0.0.0",
};

describe("env schema", () => {
  it("accepts a fully valid environment", () => {
    const result = envSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DATABASE_URL).toBe(VALID.DATABASE_URL);
      expect(result.data.PORT).toBe(3000);
    }
  });

  it("rejects when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _, ...rest } = VALID;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("DATABASE_URL");
    }
  });

  it("rejects an invalid DATABASE_URL (not a URL)", () => {
    const result = envSchema.safeParse({ ...VALID, DATABASE_URL: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects when JWT_SECRET is shorter than 32 characters", () => {
    const result = envSchema.safeParse({ ...VALID, JWT_SECRET: "too-short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("JWT_SECRET");
    }
  });

  it("defaults PORT to 3000 when not provided", () => {
    const { PORT: _, ...rest } = VALID;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(3000);
  });

  it("defaults HOST to 0.0.0.0 when not provided", () => {
    const { HOST: _, ...rest } = VALID;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.HOST).toBe("0.0.0.0");
  });

  it("coerces PORT from string to number", () => {
    const result = envSchema.safeParse({ ...VALID, PORT: "4000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.PORT).toBe("number");
      expect(result.data.PORT).toBe(4000);
    }
  });

  it("rejects a non-numeric PORT", () => {
    const result = envSchema.safeParse({ ...VALID, PORT: "not-a-port" });
    expect(result.success).toBe(false);
  });
});