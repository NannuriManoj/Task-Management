import { env } from '../../../config/env.js';
import {
  baseLayout,
  heading,
  subheading,
  paragraph,
  divider,
  metaTable,
  ctaButton,
  badge,
} from './base.js';
import type { NotificationJobData } from '../../../queues/types/jobs.js';

// Helpers

const STATUS_COLORS: Record<string, string> = {
  todo:        '#71717a',
  in_progress: '#2563eb',
  in_review:   '#d97706',
  done:        '#16a34a',
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  // 'in_progress' → 'In Progress'
}

function taskUrl(projectId: string, taskId: string): string {
  return `${env.APP_URL}/projects/${projectId}/tasks/${taskId}`;
}

function projectUrl(projectId: string): string {
  return `${env.APP_URL}/projects/${projectId}`;
}


// Return type
interface EmailContent {
  subject: string;
  html: string;
  text: string;
}


// task_assigned
type TaskAssignedData = Extract<NotificationJobData, { type: 'task_assigned' }>;

export function taskAssignedEmail(data: TaskAssignedData): EmailContent {
  const url = taskUrl(data.projectId, data.taskId);

  const html = baseLayout(
    `
    ${heading(`You've been assigned a task`)}
    ${subheading(`${data.assignedByName} assigned you a task in ${data.projectName}`)}
    ${paragraph(`Hi ${data.assigneeName},`)}
    ${paragraph(`<strong>${data.assignedByName}</strong> has assigned you the following task:`)}
    ${metaTable([
      ['Task',        data.taskTitle],
      ['Project',     data.projectName],
      ['Assigned by', data.assignedByName],
    ])}
    ${ctaButton('View Task', url)}
    ${divider()}
    ${paragraph(`<small style="color:#71717a;">If you have questions about this task, reach out to ${data.assignedByName} directly.</small>`)}
    `,
    `${data.assignedByName} assigned you "${data.taskTitle}"`
  );

  const text = [
    `You've been assigned a task`,
    ``,
    `Hi ${data.assigneeName},`,
    `${data.assignedByName} assigned you "${data.taskTitle}" in project "${data.projectName}".`,
    ``,
    `View task: ${url}`,
  ].join('\n');

  return {
    subject: `Task assigned: ${data.taskTitle}`,
    html,
    text,
  };
}


// task_status_changed
type TaskStatusChangedData = Extract<NotificationJobData, { type: 'task_status_changed' }>;

// Returns one EmailContent per recipient.
// Creator always gets one. Assignee gets one only if they exist
// and are not the same person as the creator or the one who changed it.
export function taskStatusChangedEmails(data: TaskStatusChangedData): {
  creator: EmailContent;
  assignee: EmailContent | null;
} {
  const url = taskUrl(data.projectId, data.taskId);
  const newStatusColor = STATUS_COLORS[data.newStatus] ?? '#71717a';

  function buildEmail(recipientName: string): EmailContent {
    const html = baseLayout(
      `
      ${heading(`Task status updated`)}
      ${subheading(`${data.changedByName} updated a task in ${data.projectName}`)}
      ${paragraph(`Hi ${recipientName},`)}
      ${paragraph(`<strong>${data.changedByName}</strong> changed the status of the following task:`)}
      ${metaTable([
        ['Task',       data.taskTitle],
        ['Project',    data.projectName],
        ['Old status', badge(formatStatus(data.oldStatus))],
        ['New status', badge(formatStatus(data.newStatus), newStatusColor)],
        ['Changed by', data.changedByName],
      ])}
      ${ctaButton('View Task', url)}
      `,
      `${data.changedByName} moved "${data.taskTitle}" to ${formatStatus(data.newStatus)}`
    );

    const text = [
      `Task status updated`,
      ``,
      `Hi ${recipientName},`,
      `${data.changedByName} changed "${data.taskTitle}" from ${formatStatus(data.oldStatus)} to ${formatStatus(data.newStatus)}.`,
      ``,
      `View task: ${url}`,
    ].join('\n');

    return {
      subject: `Task updated: "${data.taskTitle}" is now ${formatStatus(data.newStatus)}`,
      html,
      text,
    };
  }

  // Assignee email — null if no assignee, or if assignee is the
  // same person as creator (they'll already get the creator email)
  // or if the assignee is the one who made the change.
  const shouldNotifyAssignee =
    data.assigneeId !== null &&
    data.assigneeId !== data.creatorId &&
    data.assigneeId !== data.changedById;

  return {
    creator: buildEmail(data.creatorName),
    assignee: shouldNotifyAssignee ? buildEmail(data.assigneeName!) : null,
  };
}


// member_added
type MemberAddedData = Extract<NotificationJobData, { type: 'member_added' }>;

export function memberAddedEmail(data: MemberAddedData): EmailContent {
  const url = projectUrl(data.projectId);

  const html = baseLayout(
    `
    ${heading(`You've been added to a project`)}
    ${subheading(`${data.addedByName} added you to ${data.projectName}`)}
    ${paragraph(`Hi ${data.userName},`)}
    ${paragraph(`<strong>${data.addedByName}</strong> has added you as a member of the following project:`)}
    ${metaTable([
      ['Project',   data.projectName],
      ['Added by',  data.addedByName],
      ['Your role', badge('Member')],
    ])}
    ${paragraph(`You can now view and collaborate on all tasks in this project.`)}
    ${ctaButton('Open Project', url)}
    `,
    `You've been added to ${data.projectName} by ${data.addedByName}`
  );

  const text = [
    `You've been added to a project`,
    ``,
    `Hi ${data.userName},`,
    `${data.addedByName} added you to project "${data.projectName}".`,
    ``,
    `Open project: ${url}`,
  ].join('\n');

  return {
    subject: `You've been added to "${data.projectName}"`,
    html,
    text,
  };
}


// due_reminder
type DueReminderData = Extract<NotificationJobData, { type: 'due_remainder' }>;

export function dueReminderEmail(data: DueReminderData): EmailContent {
  const url = taskUrl(data.projectId, data.taskId);
  const formatted = new Date(data.dueDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });

  const html = baseLayout(
    `
    ${heading(`Task due tomorrow`)}
    ${subheading(`"${data.taskTitle}" is due in about 24 hours`)}
    ${paragraph(`Hi ${data.assigneeName},`)}
    ${paragraph(`This is a reminder that the following task is due tomorrow:`)}
    ${metaTable([
      ['Task',     data.taskTitle],
      ['Project',  data.projectName],
      ['Due date', badge(formatted, '#dc2626')],
    ])}
    ${ctaButton('View Task', url)}
    ${divider()}
    ${paragraph(`<small style="color:#71717a;">Mark the task as done to stop receiving reminders.</small>`)}
    `,
    `"${data.taskTitle}" is due tomorrow`
  );

  const text = [
    `Task due tomorrow`,
    ``,
    `Hi ${data.assigneeName},`,
    `"${data.taskTitle}" in "${data.projectName}" is due on ${formatted}.`,
    ``,
    `View task: ${url}`,
  ].join('\n');

  return {
    subject: `Due tomorrow: "${data.taskTitle}"`,
    html,
    text,
  };
}