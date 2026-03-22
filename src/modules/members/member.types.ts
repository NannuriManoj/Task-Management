import { z } from "zod";
import { addMemberSchema } from "./member.schema.js";

export type AddMemberBody = z.infer<typeof addMemberSchema>;