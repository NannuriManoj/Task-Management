import type { FastifyInstance } from "fastify";
import * as authController from "./auth.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { createRateLimiter } from "../../middleware/perRouteRateLimit.js";

const registerLimiter = createRateLimiter({ prefix: "auth-register", limit: 10, windowSeconds: 900 });
const loginLimiter    = createRateLimiter({ prefix: "auth-login",    limit: 10, windowSeconds: 900 });

export async function authRoutes(fastify: FastifyInstance) {

    fastify.post("/auth/register", { preHandler: registerLimiter } ,authController.register);
    fastify.post("/auth/login", { preHandler: loginLimiter } ,authController.login);

    fastify.get(
        "/auth/me",
        { preHandler: [authenticate] },
        authController.getMe
    );
}