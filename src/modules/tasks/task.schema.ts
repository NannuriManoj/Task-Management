import { z } from 'zod';

// ZOD SCHEMAS
// validate client task schema input
export const createTaskSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    status: z.enum(['pending', 'in_progress', 'in_review', 'completed']).default('pending'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    assigneeId: z.uuidv4().optional(),
    dueDate: z.date().optional()
});

export const updateTaskSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(['pending', 'in_progress', 'in_review', 'completed']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    assigneeId: z.uuidv4().nullable().optional(),
    dueDate: z.date().nullable().optional()
});

export const filterSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'in_review', 'completed']).optional(),
    priority: z.enum(['low','medium','high']).optional(),
    assigneeId: z.uuidv4().optional(),
    limit: z.coerce.number().min(5).max(50).default(10),
    offset: z.coerce.number().min(0).default(0)
});