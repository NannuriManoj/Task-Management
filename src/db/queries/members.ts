import { dbPool } from "../../config/databases.js";

export async function getUserProjectRole(
  projectId: string,
  userId: string
): Promise<{ role: string; owner_id: string } | null> {
  const { rows } = await dbPool.query(
    `SELECT pm.role, p.owner_id
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE p.id = $1 AND pm.user_id = $2
     LIMIT 1`,
    [projectId, userId]
  );

  return rows[0] || null;
}