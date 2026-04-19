import { dbPool } from "../../config/databases.js";

// Check project ownership
export async function getProjectByOwner(project_id: string, userId: string) {
    const { rows } = await dbPool.query(
        `SELECT id, name FROM projects WHERE id = $1 AND owner_id = $2`,
        [project_id, userId]
    );
    return rows[0] as { id: string; name: string } | undefined;
}

// Get all members
export async function getProjectMembers(project_id: string) {
    const { rows } = await dbPool.query(
        `SELECT u.id, u.email, u.name
         FROM users u
         JOIN project_members pm ON u.id = pm.user_id
         WHERE pm.project_id = $1`,
        [project_id]
    );
    return rows;
}

// Find user by email
export async function findUserByEmail(email: string) {
    const { rows } = await dbPool.query(
        `SELECT id, name, email FROM users WHERE email = $1`,
        [email]
    );
    return rows[0] as { id: string, name: string; email: string } | undefined;
}

// Check existing membership
export async function checkMembership(project_id: string, user_id: string) {
    const { rows } = await dbPool.query(
        `SELECT 1 FROM project_members
         WHERE project_id = $1 AND user_id = $2`,
        [project_id, user_id]
    );
    return rows.length > 0;
}

// Add member
export async function addMember(project_id: string, user_id: string) {
    const { rows } = await dbPool.query(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES ($1, $2, 'member')
         RETURNING project_id, user_id, role`,
        [project_id, user_id]
    );
    return rows[0];
}

// Get project owner
export async function getProjectOwner(project_id: string) {
    const { rows } = await dbPool.query(
        `SELECT owner_id FROM projects WHERE id = $1`,
        [project_id]
    );
    return rows[0];
}

// Remove member
export async function removeMember(project_id: string, user_id: string) {
    const { rowCount } = await dbPool.query(
        `DELETE FROM project_members
         WHERE project_id = $1 AND user_id = $2`,
        [project_id, user_id]
    );
    return rowCount;
}

// Get user by ID
export async function getUserById(userId: string) {
  const { rows } = await dbPool.query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] as { id: string; name: string; email: string } | undefined;
}