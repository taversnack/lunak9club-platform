import type { EmailMessage, EmailProvider } from '../../src/infra/email/types';

export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
    return { id: String(this.sent.length) };
  }
  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

export function linkFrom(message: EmailMessage | undefined): string {
  const m = message?.text.match(/https?:\/\/\S+/);
  if (!m) throw new Error('No link in email');
  return m[0];
}
