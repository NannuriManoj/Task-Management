import type { Job } from 'bullmq';
import type { SchedulerJobData } from '../../queues/index.js';
import { notificationQueue } from '../../queues/index.js';

export async function processScheduler(job: Job<SchedulerJobData>): Promise<void>{
    const {
        taskId,
        taskTitle,
        projectId,
        projectName,
        assigneeId,
        assigneeEmail,
        assigneeName,
        dueDate,
    } = job.data;

    await notificationQueue.add(
        'due-remainder',{
            type: 'due_remainder',
            taskId,
            taskTitle,
            projectId,
            projectName,
            assigneeId,
            assigneeEmail,
            assigneeName,
            dueDate,
        },
        {
            jobId: `due-remainder-notification:${taskId}`,
        }
    );
}