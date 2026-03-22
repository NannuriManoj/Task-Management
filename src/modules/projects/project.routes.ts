import type { FastifyInstance } from "fastify";
import * as projectController from "./project.controller.js";
import { authenticate } from "../../middleware/authenticate.js";

export async function projectRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", authenticate);

    fastify.get("/projects", projectController.getProjects);
    fastify.get("/projects/:id", projectController.getProjectById);
    fastify.post("/projects", projectController.createProject);
    fastify.patch("/projects/:id", projectController.updateProject);
    fastify.delete("/projects/:id", projectController.deleteProject);
}