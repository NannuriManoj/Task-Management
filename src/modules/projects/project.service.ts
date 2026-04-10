import { dbPool } from "../../config/databases.js";
import * as projectRepository from "./project.repository.js";
import { withCache } from "../../plugins/cache.js";
import redis from "../../config/redis.js";

// cache key helpers, keeps keys consistent across get and invalidation
const cacheKeys = {
  allProjects: (userId: string) => `cache:projects:${userId}`,
  project: (projectId: string, userId: string) => `cache:project:${projectId}:${userId}`,
};

// GET ALL PROJECTS
export async function getProjects(userId: string) {
  return withCache(
    cacheKeys.allProjects(userId),
    60, // 60 second TTL
    () => projectRepository.getProjects(userId)
  );
}

// GET PROJECT BY ID
export async function getProjectById(projectId: string, userId: string) {
  const project = await withCache(
    cacheKeys.project(projectId, userId),
    60,
    () => projectRepository.getProjectById(projectId, userId)
  );

  if (!project) throw new Error("NOT_FOUND");
  return project;
}

// CREATE PROJECT WITH TRANSACTION
export async function createProject(userId: string, data: any) {
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const project = await projectRepository.createProject(
      client,
      data.name,
      data.description ?? null,
      userId
    );

    await projectRepository.addProjectMember(client, project.id, userId);

    await client.query("COMMIT");

    // invalidate the project list cache for this user
    // so next GET /projects fetches fresh data from DB
    await redis.del(cacheKeys.allProjects(userId));

    return project;
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error("CREATE_FAILED");
  } finally {
    client.release();
  }
}

// UPDATE PROJECT
export async function updateProject(projectId: string, userId: string, data: any) {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }

  if (data.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(data.description);
  }

  if (fields.length === 0) {
    throw new Error("NO_FIELDS");
  }

  values.push(projectId, userId);

  const project = await projectRepository.updateProject(
    fields.join(", "),
    values
  );

  if (!project) throw new Error("NOT_FOUND");

  // invalidate both the list and the individual project cache
  await Promise.all([
    redis.del(cacheKeys.allProjects(userId)),
    redis.del(cacheKeys.project(projectId, userId)),
  ]);

  return project;
}

// DELETE PROJECT
export async function deleteProject(projectId: string, userId: string) {
  const project = await projectRepository.deleteProject(projectId, userId);
  if (!project) throw new Error("NOT_FOUND");

  // invalidate both caches
  await Promise.all([
    redis.del(cacheKeys.allProjects(userId)),
    redis.del(cacheKeys.project(projectId, userId)),
  ]);
}