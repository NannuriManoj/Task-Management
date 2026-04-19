import { notificationWorker } from "./notification.worker.js";
import { activityWorker } from "./activity.worker.js";
import { reportWorker } from "./report.worker.js";
import { schedulerWorker } from "./schedular.worker.js";

// registry
const workers = [ notificationWorker, activityWorker, reportWorker, schedulerWorker ];

console.log('[workers] all workers started', {
    workers: workers.map((w) => {
        name: w.name
    })
})

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
    console.log(`[workers] ${signal} received, shutting down gracefully`);
    try{
        await Promise.all(workers.map((w)=> w.close()));
        console.log('[workers] All workers closed cleanly');
        process.exit(0);
    } catch(err) {
        console.error('[workers] Error during shutdown', err);
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled errors
process.on('unhandledRejection', (reason) => {
    console.error('[workers] unhandled promise rejection', reason);
})

process.on('uncaughtException', (error) => {
    console.error('[workers] Uncaught exception', error);
    process.exit(1);
})