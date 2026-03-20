import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbPool } from "../../config/databases.js";
import { authenticate } from "../../middleware/authenticate.js";

// Validation schema for creating a project
const createProjectSchema = z.object({
    name: z.string().min(3).max(255),
    description: z.string().optional()
});

// Validation schema for updating a project
const updateProjectSchema = z.object({
    name: z.string().min(3).max(255).optional(),
    description: z.string().nullable().optional()
});

export async function projectsRoutes(fastify: FastifyInstance): Promise<void> {

    // Every route in this module requires a valid JWT token
    fastify.addHook("preHandler", authenticate);

    // GET /projects - Get all projects
    fastify.get("/projects", async (request, reply) => {
        try {
            const { rows } = await dbPool.query< 
            { 
                id: string;
                name: string;
                created_at: Date 
            } >(
                `SELECT id, name, created_at FROM projects 
                where owner_id = $1 
                ORDER BY created_at DESC`, 
                [request.user.sub]
            );
            return reply.send({ projects: rows });
        } catch (error) {
            console.error("Error fetching projects:", error);
            return reply.status(500).send({ error: "Failed to fetch projects" });
        }
    });

    // GET /projects/:id - Get a specific project by ID
    fastify.get< {Params: { id: string }} >("/projects/:id", async (request, reply) => {
    try {
        const { rows } = await dbPool.query< 
        { 
            id: string;
            name: string;
            description: string | null;
            created_at: Date 
        } >(
            `SELECT id, name, description, created_at FROM projects 
            WHERE id = $1 AND owner_id = $2`, 
            [request.params.id, request.user.sub]
        );
        
        if (rows.length === 0) {
            return reply.status(404).send({ error: "Project not found" });
        }
        return reply.send({ project: rows[0] });
    } catch (error) {
            console.error("Error fetching project:", error);
            return reply.status(500).send({ error: "Failed to fetch project by ID" });
        }
    });

    // POST /projects - Create a new project
    fastify.post("/projects", async (request, reply) => {
        const parseResult = createProjectSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({ 
                error: 'Invalid project data',
                details: parseResult.error.issues
            });
        }

        const { name, description } = parseResult.data;
        const client = await dbPool.connect();

        try {
            await client.query("BEGIN");

            const { rows } = await client.query< 
            { 
                id: string;
                name: string;
                description: string | null;
                owner_id: string;
                created_at: Date 
            } >(
                `INSERT INTO projects (name, description, owner_id) 
                VALUES ($1, $2, $3) 
                RETURNING id, name, description, owner_id, created_at`, 
                [name, description ?? null, request.user.sub]
            );
            
            const project = rows[0];
            if (!project) {
                await client.query("ROLLBACK");
                return reply.status(500).send({ error: "Failed to create project" });
            }

            await client.query(
                `INSERT INTO project_members (project_id, user_id, role)
                VALUES ($1, $2, $3)`,
                [project.id, request.user.sub, "owner"]
            );

            await client.query("COMMIT");
            return reply.status(201).send({ project });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Error creating project:", error);
            return reply.status(500).send({ error: "Failed to create project" });
        } finally {
            client.release();
        }
            
        }
);

    // PATCH /projects/:id - Update a project
    fastify.patch< {Params: { id: string }} >("/projects/:id", async (request, reply) => {
    try {
        const { rows: existing } = await dbPool.query< 
        { 
            id: string;
        } >(
            `SELECT id FROM projects WHERE id = $1 AND owner_id = $2`, 
            [request.params.id, request.user.sub]
        );

        if (existing.length === 0) {
            return reply.status(404).send({ error: "Project not found" });
        }

        const parseResult = updateProjectSchema.safeParse(request.body);

        if (!parseResult.success) {
            return reply.status(400).send({ 
                error: 'Invalid project data',
                details: parseResult.error.issues
            });
        }
        
        const { name, description } = parseResult.data;
        const fields: string[] = [];
        const values: Array<string | null> = [];
        let idx = 1;

        if (name !== undefined) {
            fields.push(`name = $${idx}`);
            values.push(name);
            idx++;
        }

        if (description !== undefined) {
            fields.push(`description = $${idx}`);
            values.push(description);
            idx++;
        }

        if (fields.length === 0) {
            return reply.status(400).send({ error: "No valid fields to update" });
        }

        values.push(request.params.id, request.user.sub);

        const { rows } = await dbPool.query< 
        { 
            id: string;
            name: string;
            description: string | null;
            owner_id: string;
            created_at: Date 
        } >(
            `UPDATE projects SET ${fields.join(", ")} 
            WHERE id = $${idx} AND owner_id = $${idx + 1} 
            RETURNING id, name, description, owner_id, created_at`, 
            values
        );
        
        return reply.send({ project: rows[0] });
    } catch (error) {
        console.error("Error updating project:", error);
        return reply.status(500).send({ error: "Failed to update project" });
    }
});

    // DELETE /projects/:id - Delete a project
    fastify.delete< {Params: { id: string }} >("/projects/:id", async (request, reply) => {
    try {
        const { rows } = await dbPool.query< 
        { 
            id: string;
        } >(
            `DELETE FROM projects WHERE id = $1 AND owner_id = $2 RETURNING id`, 
            [request.params.id, request.user.sub]
        );
        
        if (rows.length === 0) {
            return reply.status(404).send({ error: "Project not found" });
        }
        return reply.send({ message: "Project deleted successfully" });
    } catch (error) {
        console.error("Error deleting project:", error);
        return reply.status(500).send({ error: "Failed to delete project" });
    }
});
}