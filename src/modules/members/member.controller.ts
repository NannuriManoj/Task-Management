import * as memberService from "./member.service.js";
import { addMemberSchema } from "./member.schema.js";

function handleError(reply: any, error: Error) {
    switch (error.message) {
        case "NOT_FOUND":
            return reply.status(404).send({ error: "Project not found" });
        case "USER_NOT_FOUND":
            return reply.status(404).send({ error: "User not found" });
        case "ALREADY_MEMBER":
            return reply.status(400).send({ error: "User already a member" });
        case "FORBIDDEN":
            return reply.status(403).send({ error: "Only owner allowed" });
        case "OWNER_REMOVE":
            return reply.status(400).send({ error: "Owner cannot remove themselves" });
        case "MEMBER_NOT_FOUND":
            return reply.status(404).send({ error: "Member not found" });
        default:
            return reply.status(500).send({ error: "Internal Server Error" });
    }
}

export async function getMembers(request: any, reply: any) {
    try {
        const members = await memberService.getMembers(
            request.params.project_id,
            request.user.sub
        );
        return reply.send({ members });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

export async function addMember(request: any, reply: any) {
    const result = addMemberSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({ error: "Invalid email" });
    }

    try {
        const member = await memberService.addMember(
            request.params.project_id,
            request.user.sub,
            result.data.email
        );
        return reply.status(201).send({ member });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

export async function removeMember(request: any, reply: any) {
    try {
        await memberService.removeMember(
            request.params.project_id,
            request.user.sub,
            request.params.user_id
        );
        return reply.send({ message: "Member removed" });
    } catch (error: any) {
        return handleError(reply, error);
    }
}