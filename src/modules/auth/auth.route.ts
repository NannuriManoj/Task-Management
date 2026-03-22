import type { FastifyInstance } from "fastify";
import * as authController from "./auth.controller.js";
import { authenticate } from "../../middleware/authenticate.js";

export async function authRoutes(fastify: FastifyInstance) {

    fastify.post("/auth/register", authController.register);
    fastify.post("/auth/login", authController.login);

    fastify.get(
        "/auth/me",
        { preHandler: [authenticate] },
        authController.getMe
    );
}