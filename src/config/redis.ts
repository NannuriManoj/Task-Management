import { Redis } from "ioredis";
import { env } from "./env.js"
import { error } from "console";

export const redis = new Redis({
    host: env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
});

export const bullMQRedis = new Redis({
    host: env.REDIS_HOST || "localhost",
    port: Number(env.REDIS_PORT) || 6379,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 10000),
})

export async function checkRedisConnection() {
  await redis.connect();
  await redis.ping();
  console.log("Redis connection established");
}

redis.on("connect", () => {
    console.log("Connected to General use Redis...");
});

redis.on("error", (err) => {
    console.error("General use Redis error: ", err);
});

bullMQRedis.on("connect", ()=>{
    console.log("Connected to BullMQ Redis...");
});

bullMQRedis.on("error", (err)=>{
    console.error("BullMQ redis error: ", err);
});

export default redis;