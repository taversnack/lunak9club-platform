import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env, isLocalSmtpHost } from '../env';
import { logger } from '../logger';
import type { EmailMessage, EmailProvider } from './types';

let fileSeq = 0;

/**
 * Writes each message to MAIL_DIR as JSON. Used by automated tests; nothing leaves the machine.
 * Each file is written under a temporary name and then renamed, so a reader never sees half a message.
 * Names are `<ms>-<sequence>-<id>.json`, so they sort in the order the messages were sent.
 */
export class FileEmailProvider implements EmailProvider {
  readonly name = 'file';
  constructor(private readonly dir: string) {}
  async send(message: EmailMessage) {
    const id = randomUUID();
    await mkdir(this.dir, { recursive: true });
    const name = `${Date.now()}-${String(++fileSeq).padStart(6, '0')}-${id}.json`;
    const tmp = join(this.dir, `${name}.tmp`);
    await writeFile(tmp, JSON.stringify({ id, ...message }, null, 2));
    await rename(tmp, join(this.dir, name));
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

export type SmtpSettings = {
  host: string;
  port: number;
  tls: 'off' | 'starttls' | 'tls';
  user?: string;
  password?: string;
};

/** nodemailer options for the settings: plain for Mailpit, STARTTLS or implicit TLS for a real provider. */
export function smtpTransportOptions(s: SmtpSettings) {
  return {
    host: s.host,
    port: s.port,
    secure: s.tls === 'tls',
    requireTLS: s.tls === 'starttls',
    ...(s.user && s.password ? { auth: { user: s.user, pass: s.password } } : {}),
  };
}

/** SMTP: Mailpit locally, any provider's SMTP in production. With EMAIL_SANDBOX=1 only local hosts are allowed. */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport;
  constructor(
    settings: SmtpSettings,
    private readonly from: string,
    sandbox: boolean,
  ) {
    if (sandbox && !isLocalSmtpHost(settings.host)) {
      throw new Error('EMAIL_SANDBOX=1 only allows a local SMTP host (e.g. Mailpit).');
    }
    this.transport = nodemailer.createTransport(smtpTransportOptions(settings));
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
      provider = new SmtpEmailProvider(
        { host: e.SMTP_HOST, port: e.SMTP_PORT, tls: e.SMTP_TLS, user: e.SMTP_USER, password: e.SMTP_PASSWORD },
        e.EMAIL_FROM,
        e.EMAIL_SANDBOX === '1',
      );
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
