import { Worker } from "bullmq";
import { bullMQRedis } from "../config/redis.js";
import { processNotification } from "./processors/notification.processor.js";
import type { NotificationJobData } from "../queues/index.js";
import { attachDlqHandler } from "./shared/dlq-handler.js";

export const notificationWorker = new Worker<NotificationJobData>('notifications', processNotification, {
    connection: bullMQRedis,
    concurrency: 10,
    limiter:{
        max: 20,
        duration: 1000,
    },
});

attachDlqHandler(notificationWorker);