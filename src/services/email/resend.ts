import { Resend } from "resend";
import { env } from '../../config/env.js';
import type { tryCatch } from "bullmq";

const resend = new Resend(env.RESEND_API_KEY);

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

export async function sendMail(opts: SendEmailOptions): Promise<EmailResult>{
    try {
        const { data, error } = await resend.emails.send({
            from: env.EMAIL_FROM,
            to: Array.isArray(opts.to) ? opts.to : [opts.to],
            subject: opts.subject,
            html: opts.html,
            ...(opts.text && { text: opts.text }),
        })
        if(error){
            return { success: false, error: error.message }
        }
        return { success: true, messageId: data?.id };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unkown email error";
        return { success: false, error: message }
    }
}