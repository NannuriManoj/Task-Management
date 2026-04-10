import type { FastifyInstance } from "fastify";
import * as taskController from "./task.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { createRateLimiter } from "../../middleware/perRouteRateLimit.js";

const readLimiter  = createRateLimiter({ prefix: "tasks-read",  limit: 120, windowSeconds: 60 });
const writeLimiter = createRateLimiter({ prefix: "tasks-write", limit: 30,  windowSeconds: 60 });

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.addHook("preHandler", authenticate);

    fastify.get(
        "/projects/:project_id/tasks",
        { preHandler: readLimiter },
        taskController.getTasks
    );

    fastify.get(
        "/projects/:project_id/tasks/:task_id",
        { preHandler: readLimiter },
        taskController.getTaskById
    );

    fastify.post(
        "/projects/:project_id/tasks",
        { preHandler: writeLimiter },
        taskController.createTask
    );

    fastify.patch(
        "/projects/:project_id/tasks/:task_id",
        { preHandler: writeLimiter },
        taskController.updateTask
    );

    fastify.delete(
        "/projects/:project_id/tasks/:task_id",
        { preHandler: writeLimiter },
        taskController.deleteTask
    );

    fastify.get(
        "/tasks/my",
        { preHandler: readLimiter },
        taskController.getMyTasks
    );

    fastify.get(
        "/projects/:project_id/tasks/:task_id/activity",
        { preHandler: readLimiter },
        taskController.getTaskActivity
    );
}