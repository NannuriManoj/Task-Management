import { Queue } from "bullmq";
import { bullMQRedis } from "../config/redis.js";
import { defaultJobOptions } from "./config/defaults.js";
import type { ReportJobData } from "./types/jobs.js";

export const reportQueue = new Queue<ReportJobData>('reports',{
    connection: bullMQRedis,
    defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
    },
});