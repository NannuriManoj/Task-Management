import { Worker } from 'bullmq';
import { bullMQRedis } from '../config/redis.js';
import { processReport } from './processors/report.processor.js';
import type { ReportJobData } from '../queues/types/jobs.js';
import { attachDlqHandler } from './shared/dlq-handler.js';

export const reportWorker = new Worker<ReportJobData>(
  'reports',
  processReport,
  {
    connection: bullMQRedis,
    concurrency: 2,
  }
);

attachDlqHandler(reportWorker);