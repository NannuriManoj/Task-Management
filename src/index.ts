import fastify from "fastify";
import { env } from "./config/env.js";
import { checkDbConnection } from "./config/databases.js";

// Create a Fastify instance with logging enabled
const app = fastify({ logger: true });

// Define a simple health check route
app.get("/health", async (request, reply) => {
    return { status: "OK" };
});

const start = async () => {
    try {
        // Check the database connection before starting the server
        await checkDbConnection();

        // Start the server on port 3000
        await app.listen({ port: 3000, host: "0.0.0.0" });
        console.log("Server is running on http://localhost:3000");
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
};

start();