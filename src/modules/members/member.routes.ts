import type { FastifyInstance } from "fastify";
import * as memberController from "./member.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { createRateLimiter } from "../../middleware/perRouteRateLimit.js";

const readLimiter  = createRateLimiter({ prefix: "members-read",  limit: 120, windowSeconds: 60 });
const writeLimiter = createRateLimiter({ prefix: "members-write", limit: 30,  windowSeconds: 60 });

export async function memberRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", authenticate);

    fastify.get(
        "/projects/:project_id/members",
        { preHandler: readLimiter },
        memberController.getMembers
    );

    fastify.post(
        "/projects/:project_id/members",
        { preHandler: writeLimiter },
        memberController.addMember
    );

    fastify.delete(
        "/projects/:project_id/members/:user_id",
        { preHandler: writeLimiter },
        memberController.removeMember
    );
}