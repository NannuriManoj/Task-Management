import { z } from "zod";
import { createTaskSchema, updateTaskSchema, filterSchema } from "./task.schema.js";

export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;
export type FilterQuery = z.infer<typeof filterSchema>;