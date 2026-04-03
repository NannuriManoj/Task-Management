// src/index.ts
import { buildApp } from "./app.js";
import { checkDbConnection } from "./config/databases.js";
import { env } from "./config/env.js";

export const start = async () => {
    try {
        await checkDbConnection();

        const app = await buildApp();

        await app.listen({
            port: env.PORT,
            host: "0.0.0.0",
        });

        console.log(`Server running at http://localhost:${env.PORT}`);
        return app; // important for tests
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

// Only start server if not in test
if (process.env.NODE_ENV !== "test") {
    start();
}