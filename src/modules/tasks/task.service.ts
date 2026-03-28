import * as taskRepository from "./task.repository.js";
import { getUserProjectRole } from "../../db/queries/members.js";

// GET ALL TASKS
export async function getTasks(project_id: string, userId: string, filters: any) {
    const membership = await getUserProjectRole(project_id, userId);
    if (!membership) {
        throw new Error("FORBIDDEN");
    }

    const conditions: string[] = [`t.project_id = $1`];
    const values: unknown[] = [project_id];
    let i = 2;

    if (filters.status) {
        conditions.push(`t.status = $${i++}`);
        values.push(filters.status);
    }

    if (filters.priority) {
        conditions.push(`t.priority = $${i++}`);
        values.push(filters.priority);
    }

    if (filters.assigneeId) {
        conditions.push(`t.assignee_id = $${i++}`);
        values.push(filters.assigneeId);
    }

    const whereClause = conditions.join(" AND ");

    values.push(filters.limit);
    values.push(filters.offset);

    return await taskRepository.getTasks(whereClause, values);
}

// GET SINGLE TASK
export async function getTaskById(project_id: string, task_id: string, userId: string) {
    const membership = await getUserProjectRole(project_id, userId);
    if (!membership) {
        throw new Error("FORBIDDEN");
    }

    const task = await taskRepository.getTaskById(task_id, project_id);

    if (!task) {
        throw new Error("NOT_FOUND");
    }

    return task;
}

// CREATE TASK
export async function createTask(project_id: string, userId: string, data: any) {
    const membership = await getUserProjectRole(project_id, userId);

    if (!membership) {
        throw new Error("FORBIDDEN");
    }

    if (membership.role !== "admin" && membership.owner_id !== userId) {
        throw new Error("NOT_ALLOWED");
    }

    if (data.assigneeId) {
        const assigneeMembership = await getUserProjectRole(project_id, data.assigneeId);
        if (!assigneeMembership) {
            throw new Error("ASSIGNEE_NOT_MEMBER");
        }
    }

    const task = await taskRepository.createTask([
        project_id,
        userId,
        data.assigneeId ?? null,
        data.title,
        data.description ?? null,
        data.status,
        data.priority,
        data.dueDate ?? null
    ]);

    await taskRepository.insertActivity(task.id, userId, project_id, "task_created");

    return task;
}

// UPDATE TASK
export async function updateTask(
    project_id: string,
    task_id: string,
    userId: string,
    data: any
) {
    const membership = await getUserProjectRole(project_id, userId);
    if (!membership) {
        throw new Error("FORBIDDEN");
    }

    const task = await taskRepository.getTaskForUpdatePermission(task_id, project_id);

    if (!task) {
        throw new Error("NOT_FOUND");
    }

    if (
        task.creator_id !== userId &&
        task.assignee_id !== userId &&
        membership.role !== "admin" &&
        membership.owner_id !== userId
    ) {
        throw new Error("NOT_ALLOWED");
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.title !== undefined) { fields.push(`title = $${i++}`); values.push(data.title); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    if (data.status !== undefined) { fields.push(`status = $${i++}`); values.push(data.status); }
    if (data.priority !== undefined) { fields.push(`priority = $${i++}`); values.push(data.priority); }
    if (data.assigneeId !== undefined) { fields.push(`assignee_id = $${i++}`); values.push(data.assigneeId); }
    if (data.dueDate !== undefined) { fields.push(`due_date = $${i++}`); values.push(data.dueDate); }

    if (fields.length === 0) {
        throw new Error("NO_FIELDS");
    }

    const updatedTask = await taskRepository.updateTask(
        fields.join(", "),
        values,
        task_id,
        project_id
    );

    if (data.status) {
        await taskRepository.insertActivity(task_id, userId, project_id, "status_updated", data.status);
    }

    return updatedTask;
}

// DELETE TASK
export async function deleteTask(project_id: string, task_id: string, userId: string) {
    const membership = await getUserProjectRole(project_id, userId);
    if (!membership) {
        throw new Error("FORBIDDEN");
    }

    const task = await taskRepository.getTaskForUpdatePermission(task_id, project_id);

    if (!task) {
        throw new Error("NOT_FOUND");
    }

    if (task.creator_id !== userId && membership.owner_id !== userId) {
        throw new Error("NOT_ALLOWED");
    }

    // Log activity BEFORE deleting — task still exists at this point
    await taskRepository.insertActivity(task_id, userId, project_id, "task_deleted");

    const deleted = await taskRepository.deleteTask(task_id, project_id);

    if (!deleted) {
        throw new Error("NOT_FOUND");
    }

    return;
}

// GET MY TASKS
export async function getMyTasks(userId: string) {
    return await taskRepository.getMyTasks(userId);
}

// GET TASK ACTIVITY
export async function getTaskActivity(project_id: string, task_id: string, userId: string) {
    const membership = await getUserProjectRole(project_id, userId);
    if (!membership) {
        throw new Error("FORBIDDEN");
    }

    return await taskRepository.getTaskActivity(task_id, project_id);
}