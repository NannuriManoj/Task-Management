import { Queue } from "bullmq";
import { bullMQRedis } from "../config/redis.js";
import type { DlqJobData } from "./types/jobs.js";

export const dlqQueue = new Queue<DlqJobData>('failed-jobs', {
    connection: bullMQRedis,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
    },
});