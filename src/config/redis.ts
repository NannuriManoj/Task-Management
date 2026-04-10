import { Redis } from "ioredis";
import { env } from "./env.js"

export const redis = new Redis({
    host: env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
});

export async function checkRedisConnection() {
  await redis.connect();
  await redis.ping();
  console.log("Redis connection established");
}

redis.on("connect", () => {
    console.log("Connected to Redis");
});

redis.on("error", (err) => {
    console.error("Redis error:", err);
});

export default redis;