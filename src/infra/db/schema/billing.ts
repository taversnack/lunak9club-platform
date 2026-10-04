import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers } from './customers';
import { bookingDogs } from './booking';

/**
 * Single-row business details printed on invoices (D1, D51). id is always 1.
 * The invoice prefix can only change before the first invoice is issued (enforced in the service).
 */
export const businessSettings = pgTable(
  'business_settings',
  {
    id: integer().primaryKey().default(1),
    tradingName: text().notNull().default('Luna’s K9 Club'),
    legalName: text().notNull().default('Luna’s K9 Club Ltd'),
    companyNumber: text().notNull().default(''),
    registeredOffice: text().notNull().default(''),
    contactEmail: text().notNull().default(''),
    contactPhone: text().notNull().default(''),
    invoicePrefix: text().notNull().default('LK9DOUGIE-'),
    paymentTermsDays: integer().notNull().default(5),
    reminderAfterDays: integer().notNull().default(4),
    reminderTime: text().notNull().default('15:30'),
    draftDay: integer().notNull().default(25),
    sendDay: integer().notNull().default(28),
    sendTime: text().notNull().default('09:00'),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('business_settings_singleton_chk', sql`${t.id} = 1`),
    check('business_settings_terms_chk', sql`${t.paymentTermsDays} between 0 and 60`),
    check('business_settings_reminder_chk', sql`${t.reminderAfterDays} between 1 and 60`),
    check(
      'business_settings_days_chk',
      sql`${t.draftDay} between 1 and 28 and ${t.sendDay} between ${t.draftDay} and 28`,
    ),
    check(
      'business_settings_times_chk',
      sql`${t.reminderTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.sendTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check('business_settings_prefix_chk', sql`${t.invoicePrefix} ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'`),
  ],
);

/** Gap-free document numbers. Row locked (FOR UPDATE) while a number is taken. */
export const documentSequences = pgTable(
  'document_sequences',
  {
    key: text().primaryKey(),
    nextValue: integer().notNull().default(1),
  },
  (t) => [
    check('document_sequences_key_chk', sql`${t.key} in ('invoice', 'credit_note')`),
    check('document_sequences_value_chk', sql`${t.nextValue} >= 1`),
  ],
);

export const INVOICE_STATUSES = ['draft', 'scheduled', 'issued', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * An invoice. Drafts are rebuilt from bookings until approved. Once a number is assigned
 * (status issued/paid/void) the money, dates, parties and lines are locked by triggers;
 * corrections are credit notes (CLAUDE.md non-negotiable 4).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    /** membership = monthly member days; booking = paid at booking (ad hoc, extra and trial days, D6). */
    kind: text().$type<'membership' | 'booking'>().notNull().default('membership'),
    /** Month the invoice covers, YYYY-MM. */
    periodMonth: text().notNull(),
    status: text().$type<InvoiceStatus>().notNull().default('draft'),
    number: text().unique(),
    totalPence: integer().notNull().default(0),
    scheduledFor: timestamp({ withTimezone: true }),
    issuedAt: timestamp({ withTimezone: true }),
    issueDate: date({ mode: 'string' }),
    dueDate: date({ mode: 'string' }),
    reminderDueAt: timestamp({ withTimezone: true }),
    reminderSentAt: timestamp({ withTimezone: true }),
    emailSentAt: timestamp({ withTimezone: true }),
    /** Snapshots taken at issue so the invoice never changes if the customer or business details do. */
    billToName: text(),
    billToAddress: text(),
    sellerDetails: jsonb().$type<SellerSnapshot>(),
    approvedBy: text().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('invoices_customer_idx').on(t.customerId, t.periodMonth),
    index('invoices_status_idx').on(t.status),
    // One open draft per customer and month; later days go on a new (supplementary) draft.
    uniqueIndex('invoices_one_draft_uq')
      .on(t.customerId, t.periodMonth)
      .where(sql`${t.status} = 'draft' and ${t.kind} = 'membership'`),
    check('invoices_status_chk', sql`${t.status} in ('draft', 'scheduled', 'issued', 'paid', 'void')`),
    check('invoices_kind_chk', sql`${t.kind} in ('membership', 'booking')`),
    check('invoices_period_chk', sql`${t.periodMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('invoices_total_chk', sql`${t.totalPence} >= 0`),
    check('invoices_number_chk', sql`(${t.status} in ('draft', 'scheduled')) = (${t.number} is null)`),
    check(
      'invoices_issued_fields_chk',
      sql`${t.number} is null or (${t.issuedAt} is not null and ${t.issueDate} is not null and ${t.dueDate} is not null and ${t.billToName} is not null and ${t.sellerDetails} is not null)`,
    ),
    check('invoices_scheduled_chk', sql`${t.status} <> 'scheduled' or ${t.scheduledFor} is not null`),
  ],
);

export type SellerSnapshot = {
  tradingName: string;
  legalName: string;
  companyNumber: string;
  registeredOffice: string;
  contactEmail: string;
  contactPhone: string;
};

/** A billed dog-day. booking_dog_id is unique: a day is only ever billed once. */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    bookingDogId: uuid().references(() => bookingDogs.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    serviceDate: date({ mode: 'string' }),
    description: text().notNull(),
    explanation: text().notNull().default(''),
    amountPence: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoice_lines_invoice_idx').on(t.invoiceId, t.position),
    uniqueIndex('invoice_lines_booking_dog_uq').on(t.bookingDogId),
    check('invoice_lines_amount_chk', sql`${t.amountPence} >= 0`),
  ],
);

/** Money received against an invoice. Append-only. `manual` = recorded by the Owner (D53). */
export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amountPence: integer().notNull(),
    method: text().$type<'manual' | 'stripe'>().notNull(),
    receivedOn: date({ mode: 'string' }).notNull(),
    reference: text(),
    /** Stripe PaymentIntent id; unique so a webhook can never record the same payment twice. */
    providerPaymentId: text().unique(),
    checkoutAttemptId: uuid(),
    reason: text(),
    recordedBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    check('payments_amount_chk', sql`${t.amountPence} > 0`),
    check('payments_method_chk', sql`${t.method} in ('manual', 'stripe')`),
    check('payments_manual_reason_chk', sql`${t.method} <> 'manual' or length(coalesce(${t.reason}, '')) > 0`),
    check('payments_stripe_id_chk', sql`${t.method} <> 'stripe' or ${t.providerPaymentId} is not null`),
  ],
);

/**
 * A credit note against an issued invoice (D55). Append-only apart from the refund state.
 * refund_due_pence is the part that must go back to the customer's card because it was already paid.
 */
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    number: text().notNull().unique(),
    issueDate: date({ mode: 'string' }).notNull(),
    amountPence: integer().notNull(),
    reason: text().notNull(),
    refundDuePence: integer().notNull().default(0),
    refundState: text().$type<'none' | 'awaiting_refund' | 'refunded'>().notNull().default('none'),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credit_notes_invoice_idx').on(t.invoiceId),
    check('credit_notes_amount_chk', sql`${t.amountPence} > 0`),
    check(
      'credit_notes_refund_chk',
      sql`${t.refundDuePence} between 0 and ${t.amountPence} and (${t.refundState} = 'none') = (${t.refundDuePence} = 0)`,
    ),
    check('credit_notes_state_chk', sql`${t.refundState} in ('none', 'awaiting_refund', 'refunded')`),
    check('credit_notes_reason_chk', sql`length(${t.reason}) > 0`),
  ],
);

/** Which invoice lines a credit note covers (a line can be credited once). */
export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    creditNoteId: uuid()
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'restrict' }),
    invoiceLineId: uuid()
      .notNull()
      .references(() => invoiceLines.id, { onDelete: 'restrict' }),
    amountPence: integer().notNull(),
  },
  (t) => [
    uniqueIndex('credit_note_lines_line_uq').on(t.invoiceLineId),
    check('credit_note_lines_amount_chk', sql`${t.amountPence} > 0`),
  ],
);

export const REFUND_STATUSES = ['requested', 'approved', 'declined'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** A member day cancelled 48 h+ ahead after it was invoiced (D18). The Owner reviews each one. */
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    invoiceLineId: uuid()
      .notNull()
      .references(() => invoiceLines.id, { onDelete: 'restrict' }),
    bookingDogId: uuid()
      .notNull()
      .references(() => bookingDogs.id, { onDelete: 'restrict' }),
    amountPence: integer().notNull(),
    status: text().$type<RefundStatus>().notNull().default('requested'),
    creditNoteId: uuid().references(() => creditNotes.id, { onDelete: 'restrict' }),
    declineReason: text(),
    decidedBy: text().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refund_requests_booking_dog_uq').on(t.bookingDogId),
    index('refund_requests_status_idx').on(t.status),
    check('refund_requests_status_chk', sql`${t.status} in ('requested', 'approved', 'declined')`),
    check('refund_requests_amount_chk', sql`${t.amountPence} >= 0`),
    check('refund_requests_approved_chk', sql`(${t.status} = 'approved') = (${t.creditNoteId} is not null)`),
    check(
      'refund_requests_declined_chk',
      sql`${t.status} <> 'declined' or length(coalesce(${t.declineReason}, '')) > 0`,
    ),
  ],
);

/** One row per scheduled job run; (job, run_key) unique so daily jobs run once (non-negotiable 3). */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    job: text().notNull(),
    runKey: text().notNull(),
    status: text().$type<'running' | 'succeeded' | 'failed'>().notNull().default('running'),
    summary: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('job_runs_job_key_uq').on(t.job, t.runKey),
    check('job_runs_status_chk', sql`${t.status} in ('running', 'succeeded', 'failed')`),
  ],
);

export const CHECKOUT_PURPOSES = ['booking', 'invoice'] as const;
export const CHECKOUT_STATUSES = ['creating', 'open', 'paid', 'expired', 'failed'] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/**
 * One card checkout (a Stripe Checkout Session). For bookings it pays for the held places in
 * `booking_id`; for invoices it pays what was owed on `invoice_id` when it was started.
 */
export const checkoutAttempts = pgTable(
  'checkout_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    purpose: text().$type<'booking' | 'invoice'>().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    bookingId: uuid(),
    invoiceId: uuid().references(() => invoices.id, { onDelete: 'restrict' }),
    amountPence: integer().notNull(),
    description: text().notNull(),
    status: text().$type<CheckoutStatus>().notNull().default('creating'),
    provider: text().notNull(),
    providerSessionId: text().unique(),
    url: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Invoice created when a booking checkout is paid. */
    resultInvoiceId: uuid().references(() => invoices.id, { onDelete: 'restrict' }),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('checkout_attempts_status_idx').on(t.status, t.expiresAt),
    index('checkout_attempts_booking_idx').on(t.bookingId),
    index('checkout_attempts_invoice_idx').on(t.invoiceId),
    check('checkout_attempts_purpose_chk', sql`${t.purpose} in ('booking', 'invoice')`),
    check('checkout_attempts_status_chk', sql`${t.status} in ('creating', 'open', 'paid', 'expired', 'failed')`),
    check('checkout_attempts_amount_chk', sql`${t.amountPence} > 0`),
    check(
      'checkout_attempts_target_chk',
      sql`(${t.purpose} = 'booking' and ${t.bookingId} is not null) or (${t.purpose} = 'invoice' and ${t.invoiceId} is not null)`,
    ),
  ],
);

export const REFUND_STATES = ['requested', 'submitted', 'succeeded', 'failed'] as const;
export type RefundState = (typeof REFUND_STATES)[number];

/**
 * Money sent back to a card (D58). Written in the same transaction as the credit note (or
 * overpayment) that caused it, then submitted to Stripe with its id as the idempotency key.
 */
export const cardRefunds = pgTable(
  'card_refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    creditNoteId: uuid().references(() => creditNotes.id, { onDelete: 'restrict' }),
    amountPence: integer().notNull(),
    reason: text().notNull(),
    status: text().$type<RefundState>().notNull().default('requested'),
    providerRefundId: text().unique(),
    failureReason: text(),
    attempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('card_refunds_status_idx').on(t.status),
    index('card_refunds_payment_idx').on(t.paymentId),
    check('card_refunds_amount_chk', sql`${t.amountPence} > 0`),
    check('card_refunds_status_chk', sql`${t.status} in ('requested', 'submitted', 'succeeded', 'failed')`),
  ],
);

/** Every webhook event received, so a repeat delivery is processed once (non-negotiable 3). */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(1),
    lastError: text(),
  },
  (t) => [uniqueIndex('webhook_events_provider_event_uq').on(t.provider, t.eventId)],
);
