import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbPool } from "../../config/databases.js";
import { authenticate } from "../../middleware/authenticate.js";

// Validation schema for adding a member to a project
const addMemberSchema = z.object({
    email: z.email()
});

export async function membersRoutes(fastify: FastifyInstance): Promise<void> {
    
    // Apply authentication to ALL routes in this module
    // Ensures request.user is available
    fastify.addHook("preHandler", authenticate);

    // GET /projects/:project_id/members
    // Fetch all members of a project
    fastify.get<{ Params: { project_id: string } }>(
        "/projects/:project_id/members",
        async (request, reply) => {
            try {
                const { project_id } = request.params;

                // Step 1: Verify project exists AND belongs to current user
                // This ensures only the owner can view members
                const { rows: project } = await dbPool.query<{ id: string }>(
                    `SELECT id FROM projects WHERE id = $1 AND owner_id = $2`,
                    [project_id, request.user.sub]
                );

                if (project.length === 0) {
                    return reply.status(404).send({ error: "Project not found" });
                }

                // Step 2: Fetch all users linked to this project
                // Using JOIN to get user details from users table
                const { rows } = await dbPool.query<{
                    id: string;
                    email: string;
                    name: string;
                }>(
                    `SELECT u.id, u.email, u.name 
                     FROM users u
                     JOIN project_members pm ON u.id = pm.user_id
                     WHERE pm.project_id = $1`,
                    [project_id]
                );

                return reply.send({ members: rows });

            } catch (error) {
                console.error("Error fetching project members:", error);
                return reply.status(500).send({
                    error: "Failed to fetch project members"
                });
            }
        }
    );

    // POST /projects/:project_id/members
    // Add a new member to a project
    fastify.post<{ Params: { project_id: string } }>(
        "/projects/:project_id/members",
        async (request, reply) => {
            try {
                const { project_id } = request.params;

                // Step 1: Check project ownership
                const { rows: project } = await dbPool.query<{ id: string }>(
                    `SELECT id FROM projects WHERE id = $1 AND owner_id = $2`,
                    [project_id, request.user.sub]
                );

                if (project.length === 0) {
                    return reply.status(404).send({ error: "Project not found" });
                }

                // Step 2: Validate request body
                const result = addMemberSchema.safeParse(request.body);
                if (!result.success) {
                    return reply.status(400).send({
                        error: "Invalid member data",
                        details: result.error.issues
                    });
                }

                // Step 3: Find user by email
                const { rows: users } = await dbPool.query<{
                    id: string;
                }>(
                    `SELECT id FROM users WHERE email = $1`,
                    [result.data.email]
                );

                if (users.length === 0) {
                    return reply.status(404).send({ error: "User not found" });
                }

                const inviteeId = users[0]?.id; // user_id of person being added

                // Step 4: Prevent duplicate membership
                const { rows: existing } = await dbPool.query(
                    `SELECT 1 FROM project_members 
                     WHERE project_id = $1 AND user_id = $2`,
                    [project_id, inviteeId]
                );

                if (existing.length > 0) {
                    return reply.status(400).send({
                        error: "User is already a member of the project"
                    });
                }

                // Step 5: Insert into project_members (join table)
                const { rows } = await dbPool.query<{
                    project_id: string;
                    user_id: string;
                    role: string;
                }>(
                    `INSERT INTO project_members (project_id, user_id, role)
                     VALUES ($1, $2, $3)
                     RETURNING project_id, user_id, role`,
                    [project_id, inviteeId, "member"]
                );

                return reply.status(201).send({
                    member: rows[0],
                    user: {
                        id: inviteeId,
                        email: result.data.email
                    }
                });

            } catch (error) {
                console.error("Error adding member to project:", error);
                return reply.status(500).send({
                    error: "Failed to add member to project"
                });
            }
        }
    );

    // DELETE /projects/:project_id/members/:user_id
    // Remove a member from a project
    fastify.delete<{ Params: { project_id: string; user_id: string } }>(
        "/projects/:project_id/members/:user_id",
        async (request, reply) => {
            try {
                const { project_id, user_id } = request.params;

                // Step 1: Verify project ownership
                const { rows: project } = await dbPool.query<{
                    id: string;
                    owner_id: string;
                }>(
                    `SELECT id, owner_id FROM projects WHERE id = $1`,
                    [project_id]
                );

                const projectRow = project[0];

                if (!projectRow) {
                    return reply.status(404).send({ error: "Project not found" });
                }

                // Only owner can remove members
                if (projectRow.owner_id !== request.user.sub) {
                    return reply.status(403).send({
                        error: "Only the project owner can remove members"
                    });
                }

                // Prevent owner removing themselves
                if (user_id === request.user.sub) {
                    return reply.status(400).send({
                        error: "Project owner cannot remove themselves"
                    });
                }

                // Step 2: Remove member from join table
                const { rowCount } = await dbPool.query(
                    `DELETE FROM project_members 
                     WHERE project_id = $1 AND user_id = $2`,
                    [project_id, user_id]
                );

                if (rowCount === 0) {
                    return reply.status(404).send({
                        error: "Member not found in project"
                    });
                }

                return reply.send({
                    message: "Member removed from project"
                });

            } catch (error) {
                console.error("Error removing member:", error);
                return reply.status(500).send({
                    error: "Failed to remove member from project"
                });
            }
        }
    );
}