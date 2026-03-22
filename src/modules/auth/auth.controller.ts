import * as authService from "./auth.service.js";
import { registerSchema, loginSchema } from "./auth.schema.js";

function handleError(reply: any, error: Error) {
    switch (error.message) {
        case "EMAIL_EXISTS":
            return reply.status(400).send({ error: "Email already in use" });
        case "INVALID_CREDENTIALS":
            return reply.status(401).send({ error: "Invalid email or password" });
        case "CREATE_FAILED":
            return reply.status(500).send({ error: "Failed to create user" });
        case "NOT_FOUND":
            return reply.status(404).send({ error: "User not found" });
        default:
            return reply.status(500).send({ error: "Internal Server Error" });
    }
}

// REGISTER
export async function register(request: any, reply: any) {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({ error: "Invalid request data" });
    }

    try {
        const data = await authService.register(request.server, result.data);
        return reply.status(201).send(data);
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// LOGIN
export async function login(request: any, reply: any) {
    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({ error: "Invalid request data" });
    }

    try {
        const data = await authService.login(request.server, result.data);
        return reply.send(data);
    } catch (error: any) {
        return handleError(reply, error);
    }
}

// GET ME
export async function getMe(request: any, reply: any) {
    try {
        const user = await authService.getMe(request.user.sub);
        return reply.send({ user });
    } catch (error: any) {
        return handleError(reply, error);
    }
}