import type { Job } from "bullmq";
import type { ActivityJobData } from "../../queues/index.js";
import { dbPool } from "../../config/databases.js";

export async function processActivity(job: Job<ActivityJobData>): Promise<void> {
    const {
        action,
        projectId,
        actorId,
        actorName,
        resourceType,
        resourceId,
        meta,
        occuredAt,
    } = job.data;

    await dbPool.query(
        `
        INSERT INTO task_activity(
            id,
            job_id,
            project_id,
            actor_name,
            action,
            resource_type,
            resource_id,
            meta,
            occurred_at,
            created_at
        ) VALUES (
            uuid_generate_v4(), $1,$2,$3,$4,$5,$6,$7,$8,$9, NOW()
        )
            ON CONFLICT (job_id) DO NOTHING
        `, 
        [
            job.id,
            projectId,
            actorId,
            actorName,
            action,
            resourceId,
            resourceType,
            meta ? JSON.stringify(meta): null,
            occuredAt,
        ]
    );
}