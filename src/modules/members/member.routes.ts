import type { FastifyInstance } from "fastify";
import * as memberController from "./member.controller.js";
import { authenticate } from "../../middleware/authenticate.js";

export async function memberRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", authenticate);

    fastify.get(
        "/projects/:project_id/members",
        memberController.getMembers
    );

    fastify.post(
        "/projects/:project_id/members",
        memberController.addMember
    );

    fastify.delete(
        "/projects/:project_id/members/:user_id",
        memberController.removeMember
    );
}