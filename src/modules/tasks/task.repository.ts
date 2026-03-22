import { dbPool } from "../../config/databases.js";

// GET ALL TASKS WITH FILTER
export async function getTasks(
    conditions: string,
    values: unknown[]
) {
    const { rows } = await dbPool.query(
        `SELECT t.id,
                t.title,
                t.description,
                t.status,
                t.priority,
                t.due_date,
                t.created_at,
                t.updated_at,
                u.name AS assignee_name,
                u.email AS assignee_email
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE ${conditions}
         ORDER BY t.created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
    );

    return rows;
}

// GET SINGLE TASK
export async function getTaskById(task_id: string, project_id: string) {
    const { rows } = await dbPool.query(
        `SELECT t.*,
                u.name AS assignee_name,
                u.email AS assignee_email
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.id = $1 AND t.project_id = $2`,
        [task_id, project_id]
    );

    return rows[0];
}

// CREATE TASK
export async function createTask(values: unknown[]) {
    const { rows } = await dbPool.query(
        `INSERT INTO tasks
        (project_id, creator_id, assignee_id, title, description, status, priority, due_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        values
    );

    return rows[0];
}

// UPDATE TASK
export async function updateTask(
    fields: string,
    values: unknown[],
    task_id: string,
    project_id: string
) {
    const { rows } = await dbPool.query(
        `UPDATE tasks
         SET ${fields}, updated_at = NOW()
         WHERE id = $${values.length + 1}
         AND project_id = $${values.length + 2}
         RETURNING *`,
        [...values, task_id, project_id]
    );

    return rows[0];
}

// DELETE TASK
export async function deleteTask(task_id: string, project_id: string) {
    const { rowCount } = await dbPool.query(
        `DELETE FROM tasks
         WHERE id = $1 AND project_id = $2`,
        [task_id, project_id]
    );

    return rowCount;
}

// GET MY TASKS
export async function getMyTasks(userId: string) {
    const { rows } = await dbPool.query(
        `SELECT 
            t.id,
            t.title,
            t.status,
            t.priority,
            t.due_date,
            p.name AS project_name
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.assignee_id = $1
         ORDER BY t.due_date ASC`,
        [userId]
    );

    return rows;
}

// GET TASK ACTIVITY
export async function getTaskActivity(task_id: string, project_id: string) {
    const { rows } = await dbPool.query(
        `SELECT 
            ta.action,
            ta.old_value,
            ta.new_value,
            ta.created_at,
            u.name AS user_name
         FROM task_activity ta
         JOIN users u ON u.id = ta.user_id
         WHERE ta.task_id = $1
         AND ta.project_id = $2
         ORDER BY ta.created_at DESC`,
        [task_id, project_id]
    );

    return rows;
}

// INSERT ACTIVITY
export async function insertActivity(
    task_id: string,
    user_id: string,
    project_id: string,
    action: string,
    new_value: string | null = null
) {
    await dbPool.query(
        `INSERT INTO task_activity
        (task_id, user_id, project_id, action, new_value)
        VALUES ($1,$2,$3,$4,$5)`,
        [task_id, user_id, project_id, action, new_value]
    );
}

// GET TASK FOR PERMISSION CHECK (creator_id, assignee_id)
export async function getTaskForUpdatePermission(task_id: string, project_id: string) {
    const { rows } = await dbPool.query(
        `SELECT creator_id, assignee_id
         FROM tasks
         WHERE id = $1 AND project_id = $2`,
        [task_id, project_id]
    );

    return rows[0];
}