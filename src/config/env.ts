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
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);