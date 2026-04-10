import * as taskRepository from "./task.repository.js";
import { getUserProjectRole } from "../../db/queries/members.js";
import { withCache } from "../../plugins/cache.js";
import redis from "../../config/redis.js";

// cache key helpers
const cacheKeys = {
  projectTasks: (projectId: string) => `cache:tasks:project:${projectId}`,
  task:         (taskId: string)    => `cache:task:${taskId}`,
  myTasks:      (userId: string)    => `cache:tasks:my:${userId}`,
  activity:     (taskId: string)    => `cache:task:${taskId}:activity`,
};

// GET ALL TASKS
export async function getTasks(project_id: string, userId: string, filters: any) {
  const membership = await getUserProjectRole(project_id, userId);
  if (!membership) throw new Error("FORBIDDEN");

  const conditions: string[] = [`t.project_id = $1`];
  const values: unknown[] = [project_id];
  let i = 2;

  if (filters.status){ 
    conditions.push(`t.status = $${i++}`);      
    values.push(filters.status); 
}
  if (filters.priority){ 
    conditions.push(`t.priority = $${i++}`);    
    values.push(filters.priority); 
}
  if (filters.assigneeId) { 
    conditions.push(`t.assignee_id = $${i++}`); 
    values.push(filters.assigneeId); 
}

  const whereClause = conditions.join(" AND ");
  values.push(filters.limit, filters.offset);

  // filters affect results, so include them in the cache key
  const filterSuffix = [
    filters.status     ? `s:${filters.status}`         : null,
    filters.priority   ? `p:${filters.priority}`       : null,
    filters.assigneeId ? `a:${filters.assigneeId}`     : null,
    `limit:${filters.limit}`,
    `offset:${filters.offset}`,
  ].filter(Boolean).join(":");

  const cacheKey = `${cacheKeys.projectTasks(project_id)}:${filterSuffix}`;

  return withCache(cacheKey, 60, () => taskRepository.getTasks(whereClause, values));
}

// GET SINGLE TASK
export async function getTaskById(project_id: string, task_id: string, userId: string) {
  const membership = await getUserProjectRole(project_id, userId);
  if (!membership) throw new Error("FORBIDDEN");

  const task = await withCache(
    cacheKeys.task(task_id),
    60,
    () => taskRepository.getTaskById(task_id, project_id)
  );

  if (!task) throw new Error("NOT_FOUND");
  return task;
}

// CREATE TASK
export async function createTask(project_id: string, userId: string, data: any) {
  const membership = await getUserProjectRole(project_id, userId);
  if (!membership) throw new Error("FORBIDDEN");

  if (membership.role !== "admin" && membership.owner_id !== userId) {
    throw new Error("NOT_ALLOWED");
  }

  if (data.assigneeId) {
    const assigneeMembership = await getUserProjectRole(project_id, data.assigneeId);
    if (!assigneeMembership) throw new Error("ASSIGNEE_NOT_MEMBER");
  }

  const task = await taskRepository.createTask([
    project_id,
    userId,
    data.assigneeId ?? null,
    data.title,
    data.description ?? null,
    data.status,
    data.priority,
    data.dueDate ?? null,
  ]);

  await taskRepository.insertActivity(task.id, userId, project_id, "task_created");

  // a new task means the project task list is stale;
  // also bust the assignee's "my tasks" if one was set
  await Promise.all([
    redis.del(cacheKeys.projectTasks(project_id)),
    data.assigneeId ? redis.del(cacheKeys.myTasks(data.assigneeId)) : Promise.resolve(),
  ]);

  return task;
}

// UPDATE TASK
export async function updateTask(
  project_id: string,
  task_id: string,
  userId: string,
  data: any
) {
  const membership = await getUserProjectRole(project_id, userId);
  if (!membership) throw new Error("FORBIDDEN");

  const task = await taskRepository.getTaskForUpdatePermission(task_id, project_id);
  if (!task) throw new Error("NOT_FOUND");

  if (
    task.creator_id !== userId &&
    task.assignee_id !== userId &&
    membership.role !== "admin" &&
    membership.owner_id !== userId
  ) {
    throw new Error("NOT_ALLOWED");
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (data.title       !== undefined) { fields.push(`title = $${i++}`);       values.push(data.title); }
  if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
  if (data.status      !== undefined) { fields.push(`status = $${i++}`);      values.push(data.status); }
  if (data.priority    !== undefined) { fields.push(`priority = $${i++}`);    values.push(data.priority); }
  if (data.assigneeId  !== undefined) { fields.push(`assignee_id = $${i++}`); values.push(data.assigneeId); }
  if (data.dueDate     !== undefined) { fields.push(`due_date = $${i++}`);    values.push(data.dueDate); }

  if (fields.length === 0) throw new Error("NO_FIELDS");

  const updatedTask = await taskRepository.updateTask(
    fields.join(", "),
    values,
    task_id,
    project_id
  );

  if (data.status) {
    await taskRepository.insertActivity(task_id, userId, project_id, "status_updated", data.status);
  }

  // invalidate: the task itself, the project list, activity log,
  // and both the old and new assignee's "my tasks"
  const keysToInvalidate = [
    cacheKeys.task(task_id),
    cacheKeys.projectTasks(project_id),
    cacheKeys.activity(task_id),
    cacheKeys.myTasks(userId),
  ];

  if (task.assignee_id)  keysToInvalidate.push(cacheKeys.myTasks(task.assignee_id));
  if (data.assigneeId && data.assigneeId !== task.assignee_id) {
    keysToInvalidate.push(cacheKeys.myTasks(data.assigneeId));
  }

  await Promise.all(keysToInvalidate.map((k) => redis.del(k)));

  return updatedTask;
}

// DELETE TASK
export async function deleteTask(project_id: string, task_id: string, userId: string) {
  const membership = await getUserProjectRole(project_id, userId);
  if (!membership) throw new Error("FORBIDDEN");

  const task = await taskRepository.getTaskForUpdatePermission(task_id, project_id);
  if (!task) throw new Error("NOT_FOUND");

  if (task.creator_id !== userId && membership.owner_id !== userId) {
    throw new Error("NOT_ALLOWED");
  }

  await taskRepository.insertActivity(task_id, userId, project_id, "task_deleted");

  const deleted = await taskRepository.deleteTask(task_id, project_id);
  if (!deleted) throw new Error("NOT_FOUND");

  // bust the task, the project list, activity, and any assignee's my-tasks
  const keysToInvalidate = [
    cacheKeys.task(task_id),
    cacheKeys.projectTasks(project_id),
    cacheKeys.activity(task_id),
  ];

  if (task.assignee_id) keysToInvalidate.push(cacheKeys.myTasks(task.assignee_id));

  await Promise.all(keysToInvalidate.map((k) => redis.del(k)));
}

// GET MY TASKS
export async function getMyTasks(userId: string) {
  return withCache(
    cacheKeys.myTasks(userId),
    60,
    () => taskRepository.getMyTasks(userId)
  );
}

// GET TASK ACTIVITY
export async function getTaskActivity(project_id: string, task_id: string, userId: string) {
  const membership = await getUserProjectRole(project_id, userId);
  if (!membership) throw new Error("FORBIDDEN");

  return withCache(
    cacheKeys.activity(task_id),
    60,
    () => taskRepository.getTaskActivity(task_id, project_id)
  );
}