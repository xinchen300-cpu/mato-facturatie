import nodemailer from "nodemailer";

import type { Settings } from "./types";

export class MailError extends Error {}

export function render(template: string, values: Record<string, string | number>): string {
  return (template || "").replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

export function splitAddresses(text: string | null | undefined): string[] {
  return (text ?? "").split(/[;,\s]+/).filter((a) => a.includes("@"));
}

export async function sendMail(
  settings: Settings,
  message: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] },
) {
  const host = settings.smtp_host.trim();
  const sender = (settings.smtp_from_email || settings.smtp_user).trim();
  if (!host || !sender) throw new MailError("E-mail is not set up yet (Settings → E-mail).");
  if (!message.to.length) throw new MailError("No e-mail address for this client (Clients page).");
  const port = Number(settings.smtp_port || 587);
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465 && Boolean(settings.smtp_user),
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_password } : undefined,
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000,
  });
  try {
    await transport.sendMail({
      from: { name: settings.smtp_from_name || settings.company_name || "", address: sender },
      to: message.to, cc: message.cc, bcc: message.bcc, subject: message.subject, text: message.text,
      attachments: message.attachments?.map((a) => ({ ...a, contentType: "application/pdf" })),
    });
  } catch (error) {
    const text = (error as Error).message || String(error);
    if (/auth|535|534|login/i.test(text)) {
      throw new MailError("The mail server refused the login. Gmail/Outlook need an 'app password', not your normal password.");
    }
    throw new MailError(`Sending failed: ${text}`);
  }
}
