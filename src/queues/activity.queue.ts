import { Queue } from 'bullmq';
import { bullMQRedis } from '../config/redis.js';
import { defaultJobOptions } from './config/defaults.js';
import type { ActivityJobData } from './types/jobs.js';

export const activityQueue = new Queue<ActivityJobData>('activity',{
    connection: bullMQRedis,
    defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 8,
        backoff: { type: 'exponential', delay: 500 }
    },
});