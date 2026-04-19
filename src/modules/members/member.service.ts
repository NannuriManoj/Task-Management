import * as memberRepository from "./member.repository.js";
import { withCache } from "../../plugins/cache.js";
import redis from "../../config/redis.js";
import { notificationQueue, activityQueue } from "../../queues/index.js";

// Cache Keys
const cacheKeys = {
  members: (projectId: string) => `cache:members:${projectId}`,
};

// GET MEMBERS
export async function getMembers(project_id: string, userId: string) {
  const project = await memberRepository.getProjectByOwner(project_id, userId);
  if (!project) throw new Error("NOT_FOUND");

  return withCache(
    cacheKeys.members(project_id),
    60, // TTL
    () => memberRepository.getProjectMembers(project_id)
  );
}

// ADD MEMBER
export async function addMember(project_id: string, userId: string, email: string) {
  const project = await memberRepository.getProjectByOwner(project_id, userId);
  if (!project) throw new Error("NOT_FOUND");

  const user = await memberRepository.findUserByEmail(email);
  if (!user) throw new Error("USER_NOT_FOUND");

  const exists = await memberRepository.checkMembership(project_id, user.id);
  if (exists) throw new Error("ALREADY_MEMBER");

  const actor = await memberRepository.getUserById(userId);  // ← must be here
  if (!actor) throw new Error("NOT_FOUND");

  const member = await memberRepository.addMember(project_id, user.id);

  // Notification
  await notificationQueue.add(
    'member-added',
    {
      type:         'member_added',
      projectId:    project_id,
      projectName:  project.name,
      userId:       user.id,
      userEmail:    user.email,
      userName:     user.name,
      addedById:    actor.id,
      addedByName:  actor.name,
    },
    {
      // Idempotency — adding the same person twice won't send two emails
      jobId: `member-added:${project_id}:${user.id}`,
    }
  );

  // Activity log 
  await activityQueue.add('log', {
    action: 'member_added',
    projectId: project_id,
    actorId: actor.id,
    actorName: actor.name,
    resourceType: 'member',
    resourceId: user.id,
    meta: { userName: user.name, userEmail: user.email },
    occuredAt: new Date().toISOString(),
  });

  // Invalidate members cache
  await redis.del(cacheKeys.members(project_id));

  return member;
}

// REMOVE MEMBER
export async function removeMember(project_id: string, userId: string, memberId: string) {
  const project = await memberRepository.getProjectOwner(project_id);
  if (!project) throw new Error("NOT_FOUND");

  if (project.owner_id !== userId) throw new Error("FORBIDDEN");

  if (memberId === userId) throw new Error("OWNER_REMOVE");

  const actor = await memberRepository.getUserById(userId);
  if (!actor) throw new Error("NOT_FOUND");

  const removed = await memberRepository.removeMember(project_id, memberId);
  if (!removed) throw new Error("MEMBER_NOT_FOUND");

  // Activity log
  await activityQueue.add('log', {
    action:       'member_removed',
    projectId:    project_id,
    actorId:      actor.id,
    actorName:    actor.name,
    resourceType: 'member',
    resourceId:   memberId,
    meta:         {},
    occuredAt:   new Date().toISOString(),
  });

  // Invalidate members cache
  await redis.del(cacheKeys.members(project_id));

  return;
}