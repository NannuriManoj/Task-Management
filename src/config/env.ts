import { z } from "zod";
import { existsSync } from "fs";
import { resolve } from "path";

const envFile =
  process.env.NODE_ENV === "test"
    ? resolve(process.cwd(), ".env.test")
    : resolve(process.cwd(), ".env");

if (existsSync(envFile)) {
  const { config } = await import("dotenv");
  config({ path: envFile, override: false });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().min(32),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  APP_URL: z.url().optional(),
});

export const env = envSchema.parse(process.env);