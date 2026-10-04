import 'server-only';
import type { Db } from '@/infra/db/client';
import { renderInvoicePdf, type InvoicePdfModel } from '@/infra/pdf/invoice-pdf';
import { formatMonth, PAYMENT_STATE_LABELS } from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate } from '@/domain/time';
import type { Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { appUrl } from '../notify';
import { invoiceForDocument, type InvoiceDetail } from './billing';

export function pdfModel(d: InvoiceDetail): InvoicePdfModel {
  const inv = d.inv;
  return {
    number: inv.number!,
    issueDateText: formatUkDate(inv.issueDate!),
    dueDateText: formatUkDate(inv.dueDate!),
    periodText: formatMonth(inv.periodMonth),
    seller: d.seller,
    billToName: inv.billToName ?? d.customerName,
    billToAddress: inv.billToAddress,
    lines: d.lines.map((l) => ({
      description: l.description,
      amountText: pounds(l.amountPence),
      note: l.creditedBy ? `Credited on ${l.creditedBy}` : null,
    })),
    totalText: pounds(d.bal.totalPence),
    creditedText: d.bal.creditedPence ? pounds(d.bal.creditedPence) : null,
    paidText: d.bal.paidPence ? pounds(d.bal.paidPence) : null,
    dueText: pounds(d.bal.duePence),
    statusText: PAYMENT_STATE_LABELS[d.state],
    creditNotes: d.creditNotes.map((c) => ({
      number: c.number,
      dateText: formatUkDate(c.issueDate),
      amountText: pounds(c.amountPence),
      reason: c.reason,
    })),
    payments: d.payments.map((p) => ({
      dateText: formatUkDate(p.receivedOn),
      amountText: pounds(p.amountPence),
      methodText: p.method === 'stripe' ? 'Card' : 'Recorded by Luna’s K9 Club',
    })),
    payUrl: appUrl(`/account/invoices/${inv.id}`),
    paid: d.bal.duePence === 0,
  };
}

/** PDF for the Owner or the invoice's own customer. Every download is audited. */
export async function invoicePdf(db: Db, actor: Actor, rawId: string) {
  const d = await invoiceForDocument(db, actor, rawId);
  const bytes = await renderInvoicePdf(pdfModel(d));
  await recordAudit(db, { actor, action: 'invoice.pdf_downloaded', entityType: 'invoice', entityId: d.inv.id });
  return { bytes, filename: `${d.inv.number}.pdf` };
}
