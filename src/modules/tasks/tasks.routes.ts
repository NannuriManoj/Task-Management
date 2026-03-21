import type { FastifyInstance } from "fastify";
import { z } from 'zod';
import { dbPool } from "../../config/databases.js";
import { authenticate } from "../../middleware/authenticate.js";
import { getUserProjectRole } from "../../db/queries/members.js";

// ZOD SCHEMAS
// validate client task schema input
const createTaskSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(['pending', 'in_progress', 'in_review', 'completed']).default('pending'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    assigneeId: z.uuidv4().optional(),
    dueDate: z.date().optional()
});

const updateTaskSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(['pending', 'in_progress', 'in_review', 'completed']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    assigneeId: z.uuidv4().nullable().optional(),
    dueDate: z.date().nullable().optional()
});

const filterSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'in_review', 'completed']).optional(),
    priority: z.enum(['low','medium','high']).optional(),
    assigneeId: z.uuidv4().optional()
});

// TYPES FROM ZOD
// Uses Zod Schema as the single source of truth for both validation and TypeScript types

type CreateTaskBody = z.infer<typeof createTaskSchema>;
type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
type FilterQuery = z.infer<typeof filterSchema>;

// ROUTES

export async function taskroutes(fastify: FastifyInstance): Promise<void> {
    // Every route in this module requires a valid JWT token
    fastify.addHook('preHandler', authenticate);

    // GET ALL TASKS
    fastify.get<{ 
        Params:{ project_id: string }, 
        Querystring: FilterQuery
    }>('/', async (request, reply) => {
        const { project_id } = request.params;

        const membership = await getUserProjectRole(project_id, request.user.sub);
        if(!membership){
            return reply.status(403).send({ error: 'Not a project member'})
        }

        const filters = filterSchema.safeParse(request.query);
        if(!filters.success){
            return reply.status(400).send({ error: 'Invalid filters'});
        }

        const conditions: string[] = [`t.project_id = $1`];
        const values: unknown[] = [project_id];
        let i = 2;

        if(filters.data.status){
            conditions.push(`t.status = $${i++}`);
            values.push(filters.data.status);
        }

        if(filters.data.priority){
            conditions.push(`t.priority = $${i++}`);
            values.push(filters.data.priority);
        }

        if(filters.data.assigneeId){
            conditions.push(`t.assignee_id = $${i++}`);
            values.push(filters.data.assigneeId);
        }

        const { rows } = await dbPool.query(
            `SELECT t.*, 
                    u.name AS assignee_name, 
                    u.email AS assignee_email
             FROM tasks t 
             LEFT JOIN users u ON u.id = t.assignee_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY t.created_at DESC`, 
            values
        );

        return reply.send({ tasks: rows});
    });

    // GET SINGLE TASK
    fastify.get<{ Params: { project_id: string; task_id: string}}>('/:task_id', async (request, reply) => {
        const { project_id, task_id } = request.params;

        const membership = await getUserProjectRole(project_id, request.user.sub);
        if(!membership){
            return reply.status(403).send({ error: 'Not a project member'});
        }

        const { rows } = await dbPool.query(
            `SELECT t.*,
                    u.name  AS assignee_name,
                    u.email AS assignee_email
             FROM tasks t
             LEFT JOIN users u ON u.id = t.assignee_id
             WHERE t.id = $1 AND t.project_id = $2`,
            [task_id, project_id]
        );

        if(rows.length === 0){
            return reply.status(404).send({ error: 'Task not found' });
        }

        return reply.send({ task: rows[0] });
    });

    // CREATE TASK
    fastify.post<{ 
        Params:{ project_id: string},
        Body: CreateTaskBody
    }>('/', async (request, reply) => {
        const { project_id } = request.params;

        const membership = await getUserProjectRole(project_id, request.user.sub);
        if(!membership){
            return reply.status(403).send({ error: 'Not a project member'});
        }

        if (membership.role !== 'admin' && membership.owner_id !== request.user.sub) {
            return reply.status(403).send({ error: 'Not authorized to create task' });
        }

        const result = createTaskSchema.safeParse(request.body);
        if(!result.success){
            return reply.status(400).send({
                error: 'Invalid Input',
                details: result.error.issues 
            });
        }

        const { title , description, status, priority, assigneeId, dueDate } = result.data;

        if(assigneeId){
            const assigneeMembership = await getUserProjectRole(project_id, assigneeId);
            if(!assigneeMembership){
                return reply.status(400).send({ error: 'Assignee is not a member of this project'});
            }
        }

        const { rows } = await dbPool.query(
            `INSERT INTO tasks
            (project_id, creator_id, assignee_id, title, description, status, priority, due_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *`,
            [
                project_id,
                request.user.sub,
                assigneeId ?? null,
                title,
                description ?? null,
                status,
                priority,
                dueDate ?? null
            ],
        );

        return reply.status(201).send({ task: rows[0] });
    });

    // ==================== UPDATE TASK ====================
    fastify.patch<{ 
        Params: { project_id: string, task_id: string};
        Body: UpdateTaskBody
    }>('/:task_id', async (request, reply) =>{
        const { project_id, task_id } = request.params;

        const membership = await getUserProjectRole(project_id, request.user.sub);
        if (!membership) {
            return reply.status(403).send({ error: 'Not a project member' });
        }

        const result = updateTaskSchema.safeParse(request.body);
        if (!result.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                details: result.error.issues
            });
        }

        const { title, description, status, priority, assigneeId, dueDate } = result.data;

        const fields: string[]  = [];
        const values: unknown[] = [];
        let i = 1;

        if (title !== undefined) { fields.push(`title = $${i++}`); values.push(title); }
        if (description !== undefined) { fields.push(`description = $${i++}`); values.push(description); }
        if (status !== undefined) { fields.push(`status = $${i++}`); values.push(status); }
        if (priority !== undefined) { fields.push(`priority = $${i++}`); values.push(priority); }
        if (assigneeId !== undefined) { fields.push(`assignee_id = $${i++}`); values.push(assigneeId); }
        if (dueDate !== undefined) { fields.push(`due_date = $${i++}`); values.push(dueDate); }

        if(fields.length === 0){
            return reply.status(400).send({ error: "No fields to update" });
        }

        values.push(task_id);
        values.push(project_id);

        const { rows } = await dbPool.query(
            `UPDATE tasks 
             SET ${fields.join(',')}
             WHERE id = $${i} AND project_id = $${i+1}
             RETURNING *`,
            values
        );

        return reply.send({ task: rows[0] });
    });

    // ==================== DELETE TASK ====================
    fastify.delete<{
        Params: { project_id: string; task_id: string }
    }>('/:task_id', async (request, reply) => {
        const { project_id, task_id } = request.params;

        const membership = await getUserProjectRole(project_id, request.user.sub);
        if (!membership) {
            return reply.status(403).send({ error: 'Not a project member' });
        }

        if (membership.role !== 'admin' && membership.owner_id !== request.user.sub) {
            return reply.status(403).send({ error: 'Not authorized to delete task' });
        }

        const { rowCount } = await dbPool.query(
            `DELETE FROM tasks 
             WHERE id = $1 AND project_id = $2`,
            [task_id, project_id]
        );

        if (rowCount === 0) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        return reply.status(204).send();
    });
}