import fastify from "fastify";
import { checkDbConnection } from "./config/databases.js";
import { env } from "./config/env.js";
import jwtPlugin from "./plugins/jwt.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { projectsRoutes } from "./modules/projects/projects.routes.js"; 
import { membersRoutes } from "./modules/members/members.routes.js";

// Create a Fastify instance with logging enabled
const app = fastify({ logger: true });

//  Register Plugin 
await app.register(jwtPlugin);

// Register authentication routes with a prefix of "/auth"
await app.register(authRoutes, { prefix: "/auth" });

// Register project routes with a prefix of "/v1"
await app.register(projectsRoutes, { prefix: "/v1" });

// Register member routes with a prefix of "/v1"
await app.register(membersRoutes, { prefix: "/v1" });

// Define the structure of the JWT payload
export interface JwtPayload {
    sub: string; // User ID
    email: string; // User email
}

// Extend the FastifyJWT interface to include our custom payload and user properties
declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: JwtPayload;
        user: JwtPayload;
    }
}

// Define a simple health check route
app.get("/health", async (request, reply) => {
    return { status: "OK" };
});

const start = async () => {
    try {
        // Check the database connection before starting the server
        await checkDbConnection();

        // Start the server on port 3000
        await app.listen({ port: env.PORT, host: "0.0.0.0" });
        console.log("Server is running on http://localhost:" + env.PORT);
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
};

start();