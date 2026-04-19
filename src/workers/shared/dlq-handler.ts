import type { Worker } from 'bullmq';
import { dlqQueue } from '../../queues/index.js';
import type { DlqJobData } from '../../queues/types/jobs.js';

export function attachDlqHandler(worker: Worker): void {

  // Transient failure (still has retries remaining)
  worker.on('failed', async (job, err) => {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    const isExhausted = job.attemptsMade >= maxAttempts;

    if (!isExhausted) {
      console.warn(`[${worker.name}] Job failed — will retry`, {
        jobId: job.id,
        name: job.name,
        attempt: job.attemptsMade,
        maxAttempts,
        error: err.message,
      });
      return;
    }

    // All retries exhausted, forward to DLQ
    const payload: DlqJobData = {
        originalQueue:   job.queueName,
        originalJobName: job.name,
        payload:         job.data,
        errorMessage:    err.message,
        ...(err.stack && { errorStack: err.stack }), // only included when defined
        attemptsMade:    job.attemptsMade,
        failedAt:        new Date().toISOString(),
    };

    try {
      await dlqQueue.add('failed-job', payload);
      console.error(`[${worker.name}] Job exhausted all retries — moved to DLQ`, {
        jobId: job.id,
        name:  job.name,
        error: err.message,
      });
    } catch (dlqErr) {
      // If even the DLQ write fails, log it loudly so it was never silent
      console.error(`[${worker.name}] Failed to write to DLQ`, dlqErr);
    }
  });

  // Successful completion
  worker.on('completed', (job) => {
    console.log(`[${worker.name}] Job completed`, {
      jobId: job.id,
      name:  job.name,
    });
  });
}