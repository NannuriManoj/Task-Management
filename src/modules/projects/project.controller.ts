import * as projectService from "./project.service.js";
import { createProjectSchema, updateProjectSchema } from "./project.schema.js";

function handleError(reply: any, error: Error) {
    switch (error.message) {
        case "NOT_FOUND":
            return reply.status(404).send({ error: "Project not found" });
        case "NO_FIELDS":
            return reply.status(400).send({ error: "No valid fields to update" });
        case "CREATE_FAILED":
            return reply.status(500).send({ error: "Failed to create project" });
        default:
            return reply.status(500).send({ error: "Internal Server Error" });
    }
}

export async function getProjects(request: any, reply: any) {
    const projects = await projectService.getProjects(request.user.sub);
    return reply.send({ projects });
}

export async function getProjectById(request: any, reply: any) {
    try {
        const project = await projectService.getProjectById(
            request.params.id,
            request.user.sub
        );
        return reply.send({ project });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

export async function createProject(request: any, reply: any) {
    const result = createProjectSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({ error: "Invalid project data" });
    }

    try {
        const project = await projectService.createProject(
            request.user.sub,
            result.data
        );
        return reply.status(201).send({ project });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

export async function updateProject(request: any, reply: any) {
    const result = updateProjectSchema.safeParse(request.body);
    if (!result.success) {
        return reply.status(400).send({ error: "Invalid project data" });
    }

    try {
        const project = await projectService.updateProject(
            request.params.id,
            request.user.sub,
            result.data
        );
        return reply.send({ project });
    } catch (error: any) {
        return handleError(reply, error);
    }
}

export async function deleteProject(request: any, reply: any) {
    try {
        await projectService.deleteProject(
            request.params.id,
            request.user.sub
        );
        return reply.send({ message: "Project deleted successfully" });
    } catch (error: any) {
        return handleError(reply, error);
    }
}