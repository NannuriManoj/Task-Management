import { Resend } from "resend";
import { env } from '../../config/env.js';

if (!env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is not configured');
}

if (!env.EMAIL_FROM) {
  throw new Error('EMAIL_FROM is not configured');
}

const resend = new Resend(env.RESEND_API_KEY);
const FROM_ADDRESS = env.EMAIL_FROM;

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendMail(opts: SendEmailOptions): Promise<EmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,       // ← string, not string | undefined
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.text && { text: opts.text }),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    return { success: false, error: message };
  }
}