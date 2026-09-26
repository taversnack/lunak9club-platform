import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../env';
import { logger } from '../logger';
import type { EmailMessage, EmailProvider } from './types';

/** Writes each message to MAIL_DIR as JSON. Used by automated tests; nothing leaves the machine. */
export class FileEmailProvider implements EmailProvider {
  readonly name = 'file';
  constructor(private readonly dir: string) {}
  async send(message: EmailMessage) {
    const id = randomUUID();
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${Date.now()}-${id}.json`), JSON.stringify({ id, ...message }, null, 2));
    return { id };
  }
}

/** Logs that an email would be sent (template + id only — never the body or link). */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  async send(message: EmailMessage) {
    const id = randomUUID();
    logger.info({ emailId: id, template: message.template }, 'email suppressed (console transport)');
    return { id };
  }
}

/** SMTP (Mailpit locally). With EMAIL_SANDBOX=1 only local SMTP hosts are allowed. */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport;
  constructor(
    host: string,
    port: number,
    private readonly from: string,
    sandbox: boolean,
  ) {
    if (sandbox && !['localhost', '127.0.0.1', 'mailpit'].includes(host)) {
      throw new Error('EMAIL_SANDBOX=1 only allows a local SMTP host (e.g. Mailpit).');
    }
    this.transport = nodemailer.createTransport({ host, port, secure: false });
  }
  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { id: String(info.messageId) };
  }
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  const e = env();
  switch (e.EMAIL_TRANSPORT) {
    case 'file':
      provider = new FileEmailProvider(e.MAIL_DIR);
      break;
    case 'smtp':
      provider = new SmtpEmailProvider(e.SMTP_HOST, e.SMTP_PORT, e.EMAIL_FROM, e.EMAIL_SANDBOX === '1');
      break;
    default:
      provider = new ConsoleEmailProvider();
  }
  return provider;
}

/** Test seam. */
export function setEmailProvider(p: EmailProvider | undefined): void {
  provider = p;
}
