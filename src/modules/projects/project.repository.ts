import { dbPool } from "../../config/databases.js";

// GET ALL PROJECTS
export async function getProjects(userId: string) {
    const { rows } = await dbPool.query(
        `SELECT id, name, created_at
         FROM projects
         WHERE owner_id = $1
         ORDER BY created_at DESC`,
        [userId]
    );
    return rows;
}

// GET PROJECT BY ID
export async function getProjectById(projectId: string, userId: string) {
    const { rows } = await dbPool.query(
        `SELECT id, name, description, created_at
         FROM projects
         WHERE id = $1 AND owner_id = $2`,
        [projectId, userId]
    );
    return rows[0];
}

// CREATE PROJECT (TRANSACTION)
export async function createProject(client: any, name: string, description: string | null, userId: string) {
    const { rows } = await client.query(
        `INSERT INTO projects (name, description, owner_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, owner_id, created_at`,
        [name, description, userId]
    );
    return rows[0];
}

// ADD OWNER TO PROJECT_MEMBERS
export async function addProjectMember(client: any, projectId: string, userId: string) {
    await client.query(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [projectId, userId]
    );
}

// UPDATE PROJECT
export async function updateProject(fields: string, values: unknown[]) {
    const { rows } = await dbPool.query(
        `UPDATE projects SET ${fields}
         WHERE id = $${values.length - 1}
         AND owner_id = $${values.length}
         RETURNING id, name, description, owner_id, created_at`,
        values
    );
    return rows[0];
}

// DELETE PROJECT
export async function deleteProject(projectId: string, userId: string) {
    const { rows } = await dbPool.query(
        `DELETE FROM projects
         WHERE id = $1 AND owner_id = $2
         RETURNING id`,
        [projectId, userId]
    );
    return rows[0];
}