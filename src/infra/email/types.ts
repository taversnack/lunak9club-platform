export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Template key for delivery logs, e.g. "auth.verify-email". */
  template: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}
