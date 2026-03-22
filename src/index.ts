import fastify from "fastify";
import { checkDbConnection } from "./config/databases.js";
import { env } from "./config/env.js";

// Plugins
import jwtPlugin from "./plugins/jwt.js";

// Routes
import { authRoutes } from "./modules/auth/auth.route.js";
import { projectRoutes } from "./modules/projects/project.routes.js";
import { memberRoutes } from "./modules/members/member.routes.js";
import { taskRoutes } from "./modules/tasks/task.routes.js";

// Create Fastify instance
const app = fastify({ logger: true });

// Register Plugins
await app.register(jwtPlugin);

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

// Health Check
app.get("/health", async () => {
    return { status: "OK" };
});

// Register Routes with API Versioning
await app.register(authRoutes, { prefix: "/api" });

await app.register(async function v1Routes(app) {
    app.register(projectRoutes);
    app.register(memberRoutes);
    app.register(taskRoutes);
}, { prefix: "/api/v1" });

// Start Server
const start = async () => {
    try {
        await checkDbConnection();

        await app.listen({
            port: env.PORT,
            host: "0.0.0.0"
        });
        console.log(`Server running at http://localhost:${env.PORT}`);
    } catch (error) {
        app.log.error(error);
        process.exit(1);
    }
};

start();