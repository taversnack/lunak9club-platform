import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { LOGO_PNG_BASE64 } from './logo';

/** Everything printed on an invoice PDF. Built by the billing service from locked invoice data. */
export type InvoicePdfModel = {
  number: string;
  issueDateText: string;
  dueDateText: string;
  periodText: string;
  seller: {
    tradingName: string;
    legalName: string;
    companyNumber: string;
    registeredOffice: string;
    contactEmail: string;
    contactPhone: string;
  };
  billToName: string;
  billToAddress: string | null;
  lines: { description: string; amountText: string; note?: string | null }[];
  totalText: string;
  creditedText: string | null;
  paidText: string | null;
  dueText: string;
  statusText: string;
  creditNotes: { number: string; dateText: string; amountText: string; reason: string }[];
  payments: { dateText: string; amountText: string; methodText: string }[];
  payUrl: string;
  /** Nothing left to pay. */
  paid: boolean;
};

const NAVY = rgb(40 / 255, 48 / 255, 57 / 255);
const SAND = rgb(223 / 255, 200 / 255, 173 / 255);
const TEXT = rgb(39 / 255, 48 / 255, 57 / 255);
const MUTED = rgb(79 / 255, 86 / 255, 96 / 255);
const RULE = rgb(221 / 255, 211 / 255, 198 / 255);

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;

/** Standard PDF fonts only cover Windows-1252; replace anything else so rendering never fails. */
export function pdfSafe(s: string): string {
  return s.replace(/[‘’‚‛]/g, '’').replace(/[^\x20-\x7E\xA0-\xFF’“”–—•…€\n]/gu, '?');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Where a company is registered, from the prefix of its Companies House number. */
export function registrationPlace(companyNumber: string): string {
  if (/^SC/i.test(companyNumber)) return 'Scotland';
  if (/^NI/i.test(companyNumber)) return 'Northern Ireland';
  return 'England and Wales';
}

export async function renderInvoicePdf(m: InvoicePdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${m.number}`);
  doc.setAuthor(m.seller.legalName);
  doc.setCreator(m.seller.tradingName);
  doc.setProducer(m.seller.tradingName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = 0;
  const right = A4.w - MARGIN;
  const text = (s: string, x: number, yy: number, opts: { size?: number; f?: PDFFont; color?: typeof TEXT } = {}) =>
    page.drawText(pdfSafe(s), { x, y: yy, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? TEXT });
  const rightText = (
    s: string,
    xRight: number,
    yy: number,
    opts: { size?: number; f?: PDFFont; color?: typeof TEXT } = {},
  ) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 10;
    text(s, xRight - f.widthOfTextAtSize(pdfSafe(s), size), yy, opts);
  };

  const header = (continued: boolean) => {
    page.drawRectangle({ x: 0, y: A4.h - 100, width: A4.w, height: 100, color: NAVY });
    page.drawRectangle({ x: 0, y: A4.h - 104, width: A4.w, height: 4, color: SAND });
    const lw = 150;
    page.drawImage(logo, { x: MARGIN, y: A4.h - 82, width: lw, height: (lw * logo.height) / logo.width });
    rightText(continued ? 'INVOICE (continued)' : 'INVOICE', right, A4.h - 48, {
      size: 18,
      f: bold,
      color: rgb(1, 1, 1),
    });
    rightText(m.number, right, A4.h - 68, { size: 11, color: SAND });
    y = A4.h - 136;
  };
  const ensure = (needed: number) => {
    if (y - needed < 90) {
      footer();
      page = doc.addPage([A4.w, A4.h]);
      header(true);
    }
  };
  const footer = () => {
    const place = registrationPlace(m.seller.companyNumber);
    const lines = wrap(
      `${m.seller.legalName} is a private limited company registered in ${place}, company number ${m.seller.companyNumber}. Registered office: ${m.seller.registeredOffice.replace(/\n/g, ', ')}. Not registered for VAT.`,
      font,
      8,
      A4.w - MARGIN * 2,
    );
    lines.forEach((l, i) => text(l, MARGIN, 48 - i * 11, { size: 8, color: MUTED }));
  };

  header(false);

  // Parties
  const colW = (A4.w - MARGIN * 2) / 2 - 12;
  const top = y;
  text('From', MARGIN, y, { size: 9, f: bold, color: MUTED });
  y -= 14;
  text(m.seller.legalName, MARGIN, y, { f: bold });
  y -= 13;
  for (const l of wrap(m.seller.registeredOffice, font, 10, colW)) {
    text(l, MARGIN, y);
    y -= 13;
  }
  if (m.seller.contactEmail) {
    text(m.seller.contactEmail, MARGIN, y);
    y -= 13;
  }
  if (m.seller.contactPhone) {
    text(m.seller.contactPhone, MARGIN, y);
    y -= 13;
  }
  const leftBottom = y;
  y = top;
  const x2 = MARGIN + colW + 24;
  text('Bill to', x2, y, { size: 9, f: bold, color: MUTED });
  y -= 14;
  text(m.billToName, x2, y, { f: bold });
  y -= 13;
  for (const l of wrap(m.billToAddress ?? '', font, 10, colW)) {
    if (!l) continue;
    text(l, x2, y);
    y -= 13;
  }
  y = Math.min(y, leftBottom) - 16;

  // Key facts
  const facts: [string, string][] = [
    ['Invoice number', m.number],
    ['Invoice date', m.issueDateText],
    ['Service period', m.periodText],
    ['Payment due', m.dueDateText],
    ['Status', m.statusText],
  ];
  page.drawRectangle({
    x: MARGIN,
    y: y - facts.length * 15 - 6,
    width: A4.w - MARGIN * 2,
    height: facts.length * 15 + 14,
    color: rgb(247 / 255, 245 / 255, 242 / 255),
  });
  y -= 8;
  for (const [k, v] of facts) {
    text(k, MARGIN + 10, y, { size: 10, color: MUTED });
    text(v, MARGIN + 130, y, { size: 10, f: bold });
    y -= 15;
  }
  y -= 20;

  // Lines
  const tableHeader = () => {
    text('Description', MARGIN, y, { size: 9, f: bold, color: MUTED });
    rightText('Amount', right, y, { size: 9, f: bold, color: MUTED });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: NAVY });
    y -= 14;
  };
  tableHeader();
  for (const l of m.lines) {
    const desc = wrap(l.description, font, 10, A4.w - MARGIN * 2 - 90);
    const note = l.note ? wrap(l.note, font, 8, A4.w - MARGIN * 2 - 90) : [];
    ensure(desc.length * 13 + note.length * 10 + 8);
    if (y > A4.h - 150 && page !== doc.getPage(0)) tableHeader();
    desc.forEach((d, i) => text(d, MARGIN, y - i * 13));
    rightText(l.amountText, right, y);
    y -= desc.length * 13;
    note.forEach((n, i) => text(n, MARGIN, y - i * 10, { size: 8, color: MUTED }));
    y -= note.length * 10 + 2;
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: right, y: y + 2 }, thickness: 0.5, color: RULE });
    y -= 9;
  }

  // Totals
  ensure(90);
  const totals: [string, string, boolean][] = [['Total', m.totalText, false]];
  if (m.creditedText) totals.push(['Credited', `– ${m.creditedText}`, false]);
  if (m.paidText) totals.push(['Paid', `– ${m.paidText}`, false]);
  totals.push(['Amount due', m.dueText, true]);
  for (const [k, v, strong] of totals) {
    rightText(k, right - 110, y, { f: strong ? bold : font, size: strong ? 12 : 10 });
    rightText(v, right, y, { f: strong ? bold : font, size: strong ? 12 : 10 });
    y -= strong ? 20 : 15;
  }
  text('No VAT is charged: we are not registered for VAT.', MARGIN, y, { size: 9, color: MUTED });
  y -= 24;

  if (m.creditNotes.length) {
    ensure(30 + m.creditNotes.length * 14);
    text('Credit notes', MARGIN, y, { f: bold });
    y -= 15;
    for (const c of m.creditNotes) {
      for (const [i, l] of wrap(
        `${c.number} (${c.dateText}): ${c.reason}`,
        font,
        9,
        A4.w - MARGIN * 2 - 90,
      ).entries()) {
        text(l, MARGIN, y, { size: 9 });
        if (i === 0) rightText(`– ${c.amountText}`, right, y, { size: 9 });
        y -= 12;
      }
    }
    y -= 10;
  }
  if (m.payments.length) {
    ensure(30 + m.payments.length * 14);
    text('Payments received', MARGIN, y, { f: bold });
    y -= 15;
    for (const p of m.payments) {
      text(`${p.dateText} – ${p.methodText}`, MARGIN, y, { size: 9 });
      rightText(p.amountText, right, y, { size: 9 });
      y -= 12;
    }
    y -= 10;
  }
  ensure(50);
  text(m.paid ? 'Payment' : 'How to pay', MARGIN, y, { f: bold });
  y -= 14;
  for (const l of wrap(
    m.paid ? 'Paid in full – thank you.' : `Please pay by card in your ${m.seller.tradingName} account: ${m.payUrl}`,
    font,
    10,
    A4.w - MARGIN * 2,
  )) {
    text(l, MARGIN, y);
    y -= 13;
  }
  footer();
  return doc.save();
}
