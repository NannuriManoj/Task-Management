import type { FastifyInstance } from "fastify";
import * as taskController from "./task.controller.js";
import { authenticate } from "../../middleware/authenticate.js";

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
    // All task routes require authentication
    fastify.addHook("preHandler", authenticate);

    // GET all tasks (with filters)
    fastify.get(
        "/projects/:project_id/tasks",
        taskController.getTasks
    );

    // GET single task
    fastify.get(
        "/projects/:project_id/tasks/:task_id",
        taskController.getTaskById
    );

    // CREATE task
    fastify.post(
        "/projects/:project_id/tasks",
        taskController.createTask
    );

    // UPDATE task
    fastify.patch(
        "/projects/:project_id/tasks/:task_id",
        taskController.updateTask
    );

    // DELETE task
    fastify.delete(
        "/projects/:project_id/tasks/:task_id",
        taskController.deleteTask
    );

    // GET my tasks
    fastify.get(
        "/tasks/my",
        taskController.getMyTasks
    );

    // GET task activity
    fastify.get(
        "/projects/:project_id/tasks/:task_id/activity",
        taskController.getTaskActivity
    );
}