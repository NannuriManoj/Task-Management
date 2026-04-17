import type { DefaultJobOptions } from 'bullmq';

export const defaultJobOptions:DefaultJobOptions = {
    attempts: 5,
    backoff: {
        type: 'exponential',
        delay: 1000
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 }
};