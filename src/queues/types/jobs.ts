// Notification Queue
export type NotificationJobData = 
    | {
        type: 'task_assigned';
        taskId: string;
        taskTitle: string;
        projectId: string;
        projectName: string;
        assigneeId: string;
        assigneeEmail: string;
        assigneeName: string;
        assignedById: string;
        assignedByName: string;
    }
    | {
        type: 'task_status_changed';
        taskId: string;
        taskTitle: string;
        projectId: string;
        projectName: string;
        oldStatus: string;
        newStatus: string;
        changedById: string;
        changedByName: string;
        // Creator also gets notified
        creatorId: string;
        creatorName: string;
        creatorEmail: string;
        // assignee also gets notified
        assigneeId: string | null;
        assigneeEmail: string | null;
        assigneeName: string | null;
    }
    | {
        type: 'member_added';
        projectId: string;
        projectName: string;
        userId: string;
        userEmail: string;
        userName: string;
        addedById: string;
        addedByName: string;
    }
    | {
        type: 'due_remainder';
        taskId: string;
        taskTitle: string;
        projectId: string;
        projectName: string;
        assigneeId: string;
        assigneeName: string;
        assigneeEmail: string;
        dueDate: string; //ISO string
    };

// Activity Queue
export type ActivityAction = 
    | 'task_created'
    | 'task_updated'
    | 'task_assigned'
    | 'task_status_changed'
    | 'task_deleted'
    | 'member_added'
    | 'member_removed'
    | 'project_created'
    | 'project_updated'
    | 'project_deleted';

export type ActivityJobData = {
    action: ActivityAction;
    projectId: string;
    actorId: string;
    actorName: string;
    resourceType: 'task' | 'project' | 'member';
    resourceId: string;
    meta?: Record<string, unknown>;
    occuredAt: string;
}

// Scheduler Queue
export type SchedulerJobData = {
    taskId: string;
    taskTitle: string;
    projectId: string;
    projectName: string;
    assigneeId: string;
    assigneeEmail: string;
    assigneeName: string;
    dueData: string;
}

// report queue
export type ReportFormat = 'csv' | 'pdf';

export type ReportJobData = {
    format: ReportFormat;
    projectId: string;
    projectName: string;
    requestedById: string;
    requestedByEmail: string;
    filters?: {
        status?: string;
        assigneeId?: string;
        priority?: string;
        dueBefore?: string;
        dueAfter?: string;
    };
};

// dead letter queue
export type DlqJobData = {
    originalQueue: string;
    originalJobName: string;
    payload: unknown;
    errorMessage: string;
    errorStack?: string;
    attemptsMade: number;
    failedAt: string;
};
