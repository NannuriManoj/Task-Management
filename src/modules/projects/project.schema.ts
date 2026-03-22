import { z } from "zod";

export const createProjectSchema = z.object({
    name: z.string().min(3).max(255),
    description: z.string().optional()
});

export const updateProjectSchema = z.object({
    name: z.string().min(3).max(255).optional(),
    description: z.string().nullable().optional()
});