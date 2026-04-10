import * as memberRepository from "./member.repository.js";
import { withCache } from "../../plugins/cache.js";
import redis from "../../config/redis.js";

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

  const member = await memberRepository.addMember(project_id, user.id);

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

  const removed = await memberRepository.removeMember(project_id, memberId);
  if (!removed) throw new Error("MEMBER_NOT_FOUND");

  // Invalidate members cache
  await redis.del(cacheKeys.members(project_id));

  return;
}