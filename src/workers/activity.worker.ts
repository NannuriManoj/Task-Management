import { Worker } from 'bullmq';
import { bullMQRedis } from '../config/redis.js';
import { processActivity } from './processors/activity.processor.js';
import type { ActivityJobData } from '../queues/types/jobs.js';
import { attachDlqHandler } from './shared/dlq-handler.js';

export const activityWorker = new Worker<ActivityJobData>(
  'activity',
  processActivity,
  {
    connection: bullMQRedis,
    concurrency: 50,
  }
);

attachDlqHandler(activityWorker);