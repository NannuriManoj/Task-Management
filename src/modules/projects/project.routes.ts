import type { FastifyInstance } from "fastify";
import * as projectController from "./project.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { createRateLimiter } from "../../middleware/perRouteRateLimit.js";

const readLimiter  = createRateLimiter({ prefix: "projects-read",  limit: 120, windowSeconds: 60 });
const writeLimiter = createRateLimiter({ prefix: "projects-write", limit: 30,  windowSeconds: 60 });

export async function projectRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", authenticate);

    fastify.get("/projects",     { preHandler: readLimiter  }, projectController.getProjects);
    fastify.get("/projects/:id", { preHandler: readLimiter  }, projectController.getProjectById);
    fastify.post("/projects",    { preHandler: writeLimiter }, projectController.createProject);
    fastify.patch("/projects/:id",  { preHandler: writeLimiter }, projectController.updateProject);
    fastify.delete("/projects/:id", { preHandler: writeLimiter }, projectController.deleteProject);
}