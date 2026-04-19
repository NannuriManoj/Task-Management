import * as taskRepository from "./task.repository.js";
import { getUserProjectRole } from "../../db/queries/members.js";
import { withCache } from "../../plugins/cache.js";
import redis from "../../config/redis.js";
import { dbPool } from "../../config/databases.js";
import { activityQueue, notificationQueue, upsertDueRemainder, cancelDueRemainder } from '../../queues/index.js';

// cache key helpers
const cacheKeys = {
  projectTasks: (projectId: string) => `cache:tasks:project:${projectId}`,
  task: (taskId: string) => `cache:task:${taskId}`,
  myTasks: (userId: string) => `cache:tasks:my:${userId}`,
  activity: (taskId: string) => `cache:task:${taskId}:activity`,
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
    filters.status ? `s:${filters.status}` : null,
    filters.priority ? `p:${filters.priority}` : null,
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

  // actor name for queue payloads
  const actor = await taskRepository.getUserById(userId);
  if (!actor) throw new Error("NOT_FOUND")

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

  // Fetch project name for queue payloads
  const { rows: projectRows } = await dbPool.query(
    `SELECT name FROM projects WHERE id = $1`,
    [project_id]
  );
  const projectName = projectRows[0]?.name ?? '';

  // activity log through activity queue
  await activityQueue.add('log', {
    action: 'task_created',
    projectId: project_id,
    actorId: userId,
    actorName: actor.name,
    resourceType: 'task',
    resourceId: task.id,
    meta: { title: data.title, priority: data.priority },
    occuredAt: new Date().toISOString(),
  });

  // notification and schedular if assignee set
  if (data.assigneeId) {
    const assignee = await taskRepository.getUserById(data.assigneeId);
    if (assignee) {
      await notificationQueue.add(
        'task-assigned',
        {
          type: 'task_assigned',
          taskId: task.id,
          taskTitle: task.title,
          projectId: project_id,
          projectName,
          assigneeId: assignee.id,
          assigneeEmail: assignee.email,
          assigneeName: assignee.name,
          assignedById: actor.id,
          assignedByName: actor.name,
        },
        { jobId: `task-assigned:${task.id}:${assignee.id}` }
      );
    }
  }

  // schedule due remainder if due date set
  if (data.dueDate && data.assigneeId) {
    const assignee = await taskRepository.getUserById(data.assigneeId);
    if (assignee) {
      await upsertDueRemainder({
        taskId: task.id,
        taskTitle: task.title,
        projectId: project_id,
        projectName,
        assigneeId: assignee.id,
        assigneeEmail: assignee.email,
        assigneeName: assignee.name,
        dueDate: data.dueDate,
      });
    }
  }

  await Promise.all([
    redis.del(cacheKeys.projectTasks(project_id)),
    data.assignee_id ? redis.del(cacheKeys.myTasks(data.assignee_id)): Promise.resolve(),
  ])
  return task;
}

//Update Task
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

  if (data.title !== undefined) { fields.push(`title = $${i++}`); values.push(data.title); }
  if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
  if (data.status !== undefined) { fields.push(`status = $${i++}`); values.push(data.status); }
  if (data.priority !== undefined) { fields.push(`priority = $${i++}`); values.push(data.priority); }
  if (data.assigneeId !== undefined) { fields.push(`assignee_id = $${i++}`); values.push(data.assigneeId); }
  if (data.dueDate !== undefined) { fields.push(`due_date = $${i++}`); values.push(data.dueDate); }

  if (fields.length === 0) throw new Error("NO_FIELDS");

  const updatedTask = await taskRepository.updateTask(
    fields.join(", "),
    values,
    task_id,
    project_id
  );

  // Fetch actor + project name for payloads
  const actor = await taskRepository.getUserById(userId);
  if (!actor) throw new Error("NOT_FOUND");

  const { rows: projectRows } = await dbPool.query(
    `SELECT name FROM projects WHERE id = $1`,
    [project_id]
  );
  const projectName = projectRows[0]?.name ?? '';

  // Status changed
  if (data.status && data.status !== task.status) {
    await activityQueue.add('log', {
      action:       'task_status_changed',
      projectId:    project_id,
      actorId:      userId,
      actorName:    actor.name,
      resourceType: 'task',
      resourceId:   task_id,
      meta:         { oldStatus: task.status, newStatus: data.status },
      occuredAt:   new Date().toISOString(),
    });

    await notificationQueue.add(
      'task-status-changed',
      {
        type: 'task_status_changed',
        taskId: task_id,
        taskTitle: task.title,
        projectId: project_id,
        projectName,
        oldStatus: task.status,
        newStatus: data.status,
        changedById: userId,
        changedByName: actor.name,
        creatorId: task.creator_id,
        creatorEmail: task.creator_email,
        creatorName: task.creator_name,
        assigneeId: task.assignee_id,
        assigneeEmail: task.assignee_email,
        assigneeName: task.assignee_name,
      },
      { jobId: `task-status-changed:${task_id}:${data.status}` }
    );

    // Cancel reminder if task is done
    if (data.status === 'done') {
      await cancelDueRemainder(task_id);
    }
  }

  // Assignee changed
  if (data.assigneeId && data.assigneeId !== task.assignee_id) {
    const assignee = await taskRepository.getUserById(data.assigneeId);
    if (assignee) {
      await activityQueue.add('log', {
        action: 'task_assigned',
        projectId: project_id,
        actorId: userId,
        actorName: actor.name,
        resourceType: 'task',
        resourceId: task_id,
        meta: { assigneeId: assignee.id, assigneeName: assignee.name },
        occuredAt: new Date().toISOString(),
      });

      await notificationQueue.add(
        'task-assigned',
        {
          type: 'task_assigned',
          taskId: task_id,
          taskTitle: task.title,
          projectId: project_id,
          projectName,
          assigneeId: assignee.id,
          assigneeEmail: assignee.email,
          assigneeName: assignee.name,
          assignedById: actor.id,
          assignedByName: actor.name,
        },
        { jobId: `task-assigned:${task_id}:${assignee.id}` }
      );
    }
  }

  // Due date changed
  if (data.dueDate !== undefined) {
    if (data.dueDate === null) {
      // Due date removed — cancel any pending reminder
      await cancelDueRemainder(task_id);
    } else {
      const assigneeId  = data.assigneeId ?? task.assignee_id;
      const assigneeEmail = data.assigneeId ? (await taskRepository.getUserById(data.assigneeId))?.email : task.assignee_email;
      const assigneeName  = data.assigneeId ? (await taskRepository.getUserById(data.assigneeId))?.name  : task.assignee_name;

      if (assigneeId && assigneeEmail && assigneeName) {
        await upsertDueRemainder({
          taskId: task_id,
          taskTitle: task.title,
          projectId: project_id,
          projectName,
          assigneeId,
          assigneeEmail,
          assigneeName,
          dueDate: data.dueDate,
        });
      }
    }
  }

  const keysToInvalidate = [
    cacheKeys.task(task_id),
    cacheKeys.projectTasks(project_id),
    cacheKeys.activity(task_id),
    cacheKeys.myTasks(userId),
  ];

  if (task.assignee_id) keysToInvalidate.push(cacheKeys.myTasks(task.assignee_id));
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

  const actor = await taskRepository.getUserById(userId);
  if (!actor) throw new Error("NOT_FOUND");

  // Cancel any pending due reminder first
  await cancelDueRemainder(task_id);

  const deleted = await taskRepository.deleteTask(task_id, project_id);
  if (!deleted) throw new Error("NOT_FOUND");

  await activityQueue.add('log', {
    action:       'task_deleted',
    projectId:    project_id,
    actorId:      userId,
    actorName:    actor.name,
    resourceType: 'task',
    resourceId:   task_id,
    meta:         { title: task.title },
    occuredAt:   new Date().toISOString(),
  });

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