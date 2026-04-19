import type { Job } from 'bullmq';
import type { NotificationJobData } from '../../queues/index.js';
import { sendMail } from '../../services/email/resend.js';
import { taskAssignedEmail,
        taskStatusChangedEmails,
        memberAddedEmail,
        dueReminderEmail 
    } from '../../services/email/templates/notifications.js';

export async function processNotification(job: Job<NotificationJobData>): Promise<void>{
    const data = job.data;

    switch (data.type){
        case 'task_assigned': {
            const email = taskAssignedEmail(data);
            const result = await sendMail({
                to: data.assigneeEmail,
                subject: email.subject,
                html: email.html,
                text: email.text,
            });
            if(!result.success) throw new Error(`Resend failed: ${result.error}`);
            break;
        }

        case 'task_status_changed': {
            const email = taskStatusChangedEmails(data);

            const creatorResult = await sendMail({
                to: data.creatorEmail,
                subject: email.creator.subject,
                html: email.creator.html,
                text: email.creator.text
            });
            if(!creatorResult.success) throw new Error(`Resend failed (creator): ${ creatorResult.error }`);

            if(email.assignee && data.assigneeEmail){
                const assigneeResult = await sendMail({
                    to: data.assigneeEmail,
                    subject: email.assignee.subject,
                    html: email.assignee.html,
                    text: email.assignee.text,
                });
                if(!assigneeResult.success) throw new Error(`Resend failed (assignee): ${ assigneeResult.error }`);
            }
            break;
        }

        case 'member_added': {
            const email = memberAddedEmail(data);
            const result = await sendMail({
                to: data.userEmail,
                subject: email.subject,
                html: email.html,
                text: email.text,
            });
            if(!result.success) throw Error(`Resend failed: ${result.error}`);
            break;
        }

        case 'due_remainder': {
            const email = dueReminderEmail(data);
            const result = await sendMail({
                to: data.assigneeEmail,
                subject: email.subject,
                html: email.html,
                text: email.text,
            });
            if(!result.success) throw new Error(`Resend failed: ${result.error}`);
            break;
        }

        default: {
            const _exhaustive: never = data;
            throw new Error(`Unhandled notification type: ${JSON.stringify(_exhaustive)}`)
        }
    }
}