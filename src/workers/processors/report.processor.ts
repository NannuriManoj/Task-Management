import type { Job } from 'bullmq';
import { stringify } from 'csv-stringify/sync';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReportJobData } from '../../queues/types/jobs.js';
import { dbPool } from '../../config/databases.js';
import { sendMail } from '../../services/email/resend.js';
import { env } from '../../config/env.js';
import {
  baseLayout,
  heading,
  paragraph,
  metaTable,
  ctaButton,
} from '../../services/email/templates/base.js';

// Types

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_name: string | null;
  assignee_email: string | null;
  created_by_name: string;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Processor

export async function processReport(job: Job<ReportJobData>): Promise<void> {
  const {
    format,
    projectId,
    projectName,
    requestedByEmail,
    filters,
  } = job.data;

  // Build dynamic SQL query with filters
  await job.updateProgress(10);

  const conditions: string[] = ['t.project_id = $1'];
  const params: unknown[] = [projectId];
  let paramIdx = 2;

  if (filters?.status) {
    conditions.push(`t.status = $${paramIdx++}`);
    params.push(filters.status);
  }
  if (filters?.assigneeId) {
    conditions.push(`t.assignee_id = $${paramIdx++}`);
    params.push(filters.assigneeId);
  }
  if (filters?.priority) {
    conditions.push(`t.priority = $${paramIdx++}`);
    params.push(filters.priority);
  }
  if (filters?.dueBefore) {
    conditions.push(`t.due_date <= $${paramIdx++}`);
    params.push(new Date(filters.dueBefore));
  }
  if (filters?.dueAfter) {
    conditions.push(`t.due_date >= $${paramIdx++}`);
    params.push(new Date(filters.dueAfter));
  }

  // Fetch tasks 
  const { rows: tasks } = await dbPool.query<TaskRow>(
    `
    SELECT
      t.id,
      t.title,
      t.description,
      t.status,
      t.priority,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email,
      creator.name AS created_by_name,
      t.due_date,
      t.created_at,
      t.updated_at
    FROM tasks t
    LEFT JOIN users assignee ON assignee.id = t.assignee_id
    JOIN users creator  ON creator.id  = t.created_by
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.created_at DESC
    `,
    params
  );

  await job.updateProgress(40);

  // Generate CSV
  if (format !== 'csv') {
    throw new Error(`Report format "${format}" is not yet supported.`);
  }

  const csv = stringify(tasks, {
    header: true,
    columns: {
      id: 'ID',
      title: 'Title',
      description: 'Description',
      status: 'Status',
      priority: 'Priority',
      assignee_name: 'Assignee',
      assignee_email: 'Assignee Email',
      created_by_name: 'Created By',
      due_date: 'Due Date',
      created_at: 'Created At',
      updated_at: 'Updated At',
    },
    cast: {
      date:   (v) => v.toISOString(),
      object: (v) => (v === null ? '' : String(v)),
    },
  });

  await job.updateProgress(70);

  // Stage 4: Save file to disk
  const reportsDir = join(process.cwd(), 'reports');
  await mkdir(reportsDir, { recursive: true });

  const fileId = randomUUID();
  const fileName = `${projectName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.csv`;
  const filePath = join(reportsDir, `${fileId}-${fileName}`);

  await writeFile(filePath, csv, 'utf-8');

  // TODO: In production,we replace the above two lines with an S3/R2 upload
  // and use the returned presigned URL instead of constructing one below.
  const downloadUrl = `${env.APP_URL}/reports/${fileId}/${fileName}`;

  await job.updateProgress(85);

  // Email the download link
  const html = baseLayout(
    `
    ${heading('Your report is ready')}
    ${paragraph(`Your task export for <strong>${projectName}</strong> is ready to download.`)}
    ${metaTable([
      ['Project',        projectName],
      ['Format',         format.toUpperCase()],
      ['Tasks exported', String(tasks.length)],
      ['Generated at',   new Date().toLocaleString()],
    ])}
    ${ctaButton('Download Report', downloadUrl)}
    ${paragraph(`<small style="color:#71717a;">This link will expire in 24 hours.</small>`)}
    `,
    `Your ${projectName} task export is ready`
  );

  const result = await sendMail({
    to:      requestedByEmail,
    subject: `Your report is ready: ${projectName}`,
    html,
    text: [
      `Your task export for "${projectName}" is ready.`,
      `Tasks exported: ${tasks.length}`,
      ``,
      `Download: ${downloadUrl}`,
      `(Link expires in 24 hours)`,
    ].join('\n'),
  });

  if (!result.success) {
    throw new Error(`Failed to email report: ${result.error}`);
  }

  await job.updateProgress(100);
}