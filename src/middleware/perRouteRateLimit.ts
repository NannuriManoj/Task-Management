import type { FastifyRequest, FastifyReply } from 'fastify';
import { slidingWindowRateLimit } from '../plugins/rateLimitHelper.js';

interface RateLimiterOptions {
  prefix: string;
  limit: number;
  windowSeconds: number;
}

export function createRateLimiter({ prefix, limit, windowSeconds }: RateLimiterOptions) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const identifier = (request.user?.sub as string) || request.ip;

    const results = await slidingWindowRateLimit(
      `${prefix}:${identifier}`,
      limit,
      windowSeconds
    );

    if (!results.allowed) {
      return reply.code(429).send({
        error: 'Too many requests',
        message: `Try again in ${results.retryAfter} seconds`,
        retryAfter: results.retryAfter,
      });
    }
  };
}