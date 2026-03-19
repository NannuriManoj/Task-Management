import type { FastifyReply, FastifyRequest } from "fastify";

// Middleware function to authenticate requests using JWT
export async function authenticate(
    request: FastifyRequest, 
    reply: FastifyReply) : Promise<void> {
    try {
        // Verify the JWT token from the request
        await request.jwtVerify();
    } catch (err) {
        // If verification fails, send an unauthorized response
        return reply.status(401).send({ error: "Unauthorized" });
    }
}