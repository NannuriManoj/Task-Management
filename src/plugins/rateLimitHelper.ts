import redis from '../config/redis.js';

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  count: number;
  remaining?: number;
  retryAfter?: number;
}

export async function slidingWindowRateLimit(
  identifier: string,
  limit: number = 10,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const key = `ratelimit:sliding:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const pipeline = redis.pipeline();

  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  pipeline.zcard(key);
  pipeline.expire(key, windowSeconds);

  const results = await pipeline.exec();

  if (!results) throw new Error('Redis pipeline failed');

  const cardResult = results[2];
  if (!cardResult || cardResult[0]) throw new Error('Redis zcard failed');

  const requestCount = cardResult[1] as number;

  if (requestCount > limit) {
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const oldestScore = oldest[1];

    if (!oldestScore) throw new Error('Could not read oldest entry from Redis');

    const oldestTime = parseInt(oldestScore, 10);
    const retryAfter = Math.ceil((oldestTime + windowSeconds * 1000 - now) / 1000);

    return { allowed: false, limit, count: requestCount, retryAfter };
  }

  return {
    allowed: true,
    limit,
    count: requestCount,
    remaining: limit - requestCount,
  };
}