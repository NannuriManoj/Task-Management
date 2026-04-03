// src/app.ts
import fastify from "fastify";
import jwtPlugin from "./plugins/jwt.js";

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
    app.get("/health", async () => {
        return { status: "ok" };
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