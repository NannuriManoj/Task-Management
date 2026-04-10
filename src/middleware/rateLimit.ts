import type { FastifyRequest, FastifyReply } from 'fastify';
import { slidingWindowRateLimit } from '../plugins/rateLimitHelper.js';

export async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const identifier = (request.user?.sub as string) || request.ip;
  const results = await slidingWindowRateLimit(identifier, 10, 60);

  reply.header('X-RateLimit-Limit', results.limit);
  reply.header('X-RateLimit-Remaining', results.remaining ?? 0);
  reply.header('X-RateLimit-Count', results.count);

  if (!results.allowed) {
    request.log.warn(
      { identifier, count: results.count, limit: results.limit, retryAfter: results.retryAfter },
      'Rate limit exceeded'
    );

    reply.header('Retry-After', results.retryAfter);

    return reply.code(429).send({
      error: 'Too many requests',
      message: `Rate limit exceeded. Try again in ${results.retryAfter} seconds.`,
      retryAfter: results.retryAfter,
    });
  }

  request.log.info({ identifier, count: results.count, remaining: results.remaining }, 'Request allowed');
}