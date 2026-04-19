import { Queue } from 'bullmq';
import { bullMQRedis } from '../config/redis.js';
import { defaultJobOptions } from './config/defaults.js';
import type { NotificationJobData } from './types/jobs.js';

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
    connection: bullMQRedis,
    defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
    },
});