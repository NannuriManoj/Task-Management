import { z } from "zod";
import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

// Load the right .env file synchronously before Zod parses.
// Priority: .env.test (when NODE_ENV=test) → .env → already-set process.env
const envFile =
  process.env.NODE_ENV === "test"
    ? resolve(process.cwd(), ".env.test")
    : resolve(process.cwd(), ".env");

if (existsSync(envFile)) {
  // override: false means already-set env vars (e.g. from a real CI environment)
  // take precedence over the file — safe for both local dev and CI
  config({ path: envFile, override: false });
}

const envSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);