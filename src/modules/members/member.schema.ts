import { z } from "zod";

export const addMemberSchema = z.object({
    email: z.email()
});