import { z } from "zod";
import { createProjectSchema, updateProjectSchema } from "./project.schema.js";

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;