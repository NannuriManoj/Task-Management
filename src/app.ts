// src/app.ts
import fastify from "fastify";
import jwtPlugin from "./plugins/jwt.js";
import { redis } from "./config/redis.js";
import { dbPool } from "./config/databases.js";

import { authRoutes } from "./modules/auth/auth.route.js";
import { projectRoutes } from "./modules/projects/project.routes.js";
import { memberRoutes } from "./modules/members/member.routes.js";
import { taskRoutes } from "./modules/tasks/task.routes.js";

// JWT Types
export interface JwtPayload {
    sub: string;
    email: string;
}

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: JwtPayload;
        user: JwtPayload;
    }
}

export async function buildApp() {
    const app = fastify({ logger: true });

    // Plugins
    await app.register(jwtPlugin);

    // Health Check
    app.get("/health", async (request, reply) => {
    const health = {
        status:   "ok",
        database: "ok",
        redis:    "ok",
    };

    try {
        await dbPool.query("SELECT 1");
    } catch {
        health.status   = "degraded";
        health.database = "unreachable";
    }

    try {
        await redis.ping();
    } catch {
        health.status = "degraded";
        health.redis  = "unreachable";
    }

    const statusCode = health.status === "ok" ? 200 : 503;
        return reply.code(statusCode).send(health);
    });

    // Routes
    await app.register(authRoutes, { prefix: "/api" });

    await app.register(async function v1Routes(app) {
        app.register(projectRoutes);
        app.register(memberRoutes);
        app.register(taskRoutes);
    }, { prefix: "/api/v1" });

    return app;
}