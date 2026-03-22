import { z } from "zod";
import { registerSchema, loginSchema } from "./auth.schema.js";

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;