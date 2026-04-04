/**
 * tests/setup.ts
 *
 * Global test setup — runs before every test file.
 * Loads .env.test so all tests get a consistent environment
 * without touching the real development database.
 */
process.env.NODE_ENV = "test";

import { config } from "dotenv";
config({ path: ".env.test", override: false });