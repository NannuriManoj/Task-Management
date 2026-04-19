import { Worker } from 'bullmq';
import { bullMQRedis } from '../config/redis.js';
import { processScheduler } from './processors/schedular.processor.js';
import type { SchedulerJobData } from '../queues/types/jobs.js';
import { attachDlqHandler } from './shared/dlq-handler.js';

export const schedulerWorker = new Worker<SchedulerJobData>(
  'scheduler',
  processScheduler,
  {
    connection: bullMQRedis,
    concurrency: 5,
  }
);

attachDlqHandler(schedulerWorker);

