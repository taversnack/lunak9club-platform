import pino from 'pino';

/**
 * Structured logger with redaction. Never log medical, behavioural, payment,
 * authentication or contact details — redaction is a safety net, not permission.
 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'url',
  '*.url',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'address',
  '*.address',
  'headers.cookie',
  'headers.authorization',
  '*.medical',
  '*.medication',
  '*.allergies',
  '*.behaviour',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { app: 'lunak9' },
});
