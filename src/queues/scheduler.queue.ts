import { Queue } from "bullmq";
import { bullMQRedis } from "../config/redis.js";
import { defaultJobOptions } from "./config/defaults.js";
import type { SchedulerJobData } from "./types/jobs.js";

export const SchedulerQueue = new Queue<SchedulerJobData>('scheduler', {
    connection: bullMQRedis,
    defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
    }
});

// helpers

const REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000; // notify before 24hrs

export async function upsertDueRemainder(data: SchedulerJobData): Promise<void> {
    const jobId = `due-remainder:${data.taskId}`;
    const dueData = new Date(data.dueDate);
    const delay = Math.max(0, dueData.getTime() - Date.now() - REMINDER_LEAD_TIME_MS);

    // remove the exisiting due dates, useful when due dates are changed.
    await SchedulerQueue.remove(jobId);

    // if dueDate is in past no point in scheduling it
    if(dueData.getTime() < Date.now()) return;

    await SchedulerQueue.add('due-remainder', data, { jobId, delay });
}

export async function cancelDueRemainder(taskId: string): Promise<void>{
    await SchedulerQueue.remove(`due-remainder:${taskId}`);
}
