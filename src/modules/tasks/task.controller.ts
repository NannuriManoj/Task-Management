import * as taskService from "./task.service.js";
import { createTaskSchema, updateTaskSchema, filterSchema } from "./task.schema.js";

// Helper function to map service errors to HTTP responses
function handleError(reply: any, error: Error) {
    switch (error.message) {
        case "FORBIDDEN":
            return reply.status(403).send({ error: "Not a project member" });

        case "NOT_ALLOWED":
            return reply.status(403).send({ error: "Not authorized" });

        case "NOT_FOUND":
            return reply.status(404).send({ error: "Task not found" });

        case "NO_FIELDS":
            return reply.status(400).send({ error: "No fields to update" });

        case "ASSIGNEE_NOT_MEMBER":
            return reply.status(400).send({ error: "Assignee is not a member of this project" });

        default:
            return reply.status(500).send({ error: "Internal Server Error" });
    }
}

// GET ALL TASKS
export async function getTasks(request: any, reply: any) {
    const { project_id } = request.params;

    const filters = filterSchema.safeParse(request.query);
    if (!filters.success) {
        return reply.status(400).send({ error: "Invalid filters" });
    }

    try {
        const tasks = await taskService.getTasks(
            project_id,
            request.user.sub,
            filters.data
        );

        return reply.send({ tasks });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// GET SINGLE TASK
export async function getTaskById(request: any, reply: any) {
    const { project_id, task_id } = request.params;

    try {
        const task = await taskService.getTaskById(
            project_id,
            task_id,
            request.user.sub
        );

        return reply.send({ task });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// CREATE TASK
export async function createTask(request: any, reply: any) {
    const { project_id } = request.params;

    const result = createTaskSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({
            error: "Invalid input",
            details: result.error.issues
        });
    }

    try {
        const task = await taskService.createTask(
            project_id,
            request.user.sub,
            result.data
        );

        return reply.status(201).send({ task });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// UPDATE TASK
export async function updateTask(request: any, reply: any) {
    const { project_id, task_id } = request.params;

    const result = updateTaskSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({
            error: "Invalid input",
            details: result.error.issues
        });
    }

    try {
        const task = await taskService.updateTask(
            project_id,
            task_id,
            request.user.sub,
            result.data
        );

        return reply.send({ task });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// DELETE TASK
export async function deleteTask(request: any, reply: any) {
    const { project_id, task_id } = request.params;

    try {
        await taskService.deleteTask(
            project_id,
            task_id,
            request.user.sub
        );

        return reply.status(204).send();
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// GET MY TASKS
export async function getMyTasks(request: any, reply: any) {
    try {
        const tasks = await taskService.getMyTasks(request.user.sub);
        return reply.send({ tasks });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// GET TASK ACTIVITY
export async function getTaskActivity(request: any, reply: any) {
    const { project_id, task_id } = request.params;

    try {
        const activity = await taskService.getTaskActivity(
            project_id,
            task_id,
            request.user.sub
        );

        return reply.send({ activity });
    } catch (error: any) {
        return handleError(reply, error);
    }
}