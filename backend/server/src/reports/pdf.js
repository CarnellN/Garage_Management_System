// PDF rendering for reports and invoices. Every document carries the company logo and name,
// the report title, the applied filters, the generation date/time and page numbers.
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';

const BRAND = '#1f4e79';
const MUTED = '#5f6b7a';
const RULE = '#d0d7de';
const STRIPE = '#f3f6f9';

export const nairobiTime = (value, withTime = true) => {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: 'short', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
};
export const money = (value) => {
  const [whole, fraction = '00'] = String(value ?? '0.00').split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
};

/** Draws the default logo (a gear with a wrench-like bar and initials) when no image file is configured. */
function drawDefaultLogo(doc, x, y, size, initials) {
  const cx = x + size / 2, cy = y + size / 2, outer = size / 2, inner = size * 0.36;
  doc.save();
  for (let tooth = 0; tooth < 8; tooth++) {
    const angle = (Math.PI / 4) * tooth;
    doc.save().translate(cx, cy).rotate((angle * 180) / Math.PI)
      .rect(-size * 0.07, -outer, size * 0.14, size * 0.2).fill(BRAND).restore();
  }
  doc.circle(cx, cy, outer * 0.8).fill(BRAND);
  doc.circle(cx, cy, inner).fill('#ffffff');
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(size * 0.26)
    .text(initials, x, cy - size * 0.13, { width: size, align: 'center', lineBreak: false });
  doc.restore();
}

function header(doc, { company, title, subtitle, filters }) {
  const top = 36, left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const logoSize = 52;
  if (company.logoFile && existsSync(company.logoFile)) {
    try { doc.image(company.logoFile, left, top, { fit: [logoSize, logoSize] }); }
    catch { drawDefaultLogo(doc, left, top, logoSize, company.initials); }
  } else drawDefaultLogo(doc, left, top, logoSize, company.initials);
  const textLeft = left + logoSize + 12;
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(16).text(company.name, textLeft, top + 2, { width: width - logoSize - 12 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
    .text([company.address, company.phone, company.email].filter(Boolean).join('  |  '), textLeft, doc.y + 2, { width: width - logoSize - 12 });
  doc.moveTo(left, top + logoSize + 10).lineTo(left + width, top + logoSize + 10).lineWidth(1.2).strokeColor(BRAND).stroke();
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(title, left, top + logoSize + 20, { width });
  if (subtitle) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(subtitle, left, doc.y + 1, { width });
  if (filters?.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
      .text(`Filters: ${filters.join('  •  ')}`, left, doc.y + 3, { width });
  }
  doc.moveDown(0.8);
}

function footers(doc, { generatedAt, generatedBy, company }) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
    const y = doc.page.height - 34;
    // Writing inside the bottom margin must not trigger an automatic page break.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(left, y - 6).lineTo(left + width, y - 6).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
      .text(`Generated ${nairobiTime(generatedAt)} (EAT)${generatedBy ? ` by ${generatedBy}` : ''}  •  ${company.name}`, left, y, { width: width - 80, lineBreak: false });
    doc.text(`Page ${index - range.start + 1} of ${range.count}`, left + width - 80, y, { width: 80, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function table(doc, columns, rows, context) {
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const totalWeight = columns.reduce((sum, column) => sum + (column.width ?? 1), 0);
  const widths = columns.map((column) => ((column.width ?? 1) / totalWeight) * width);
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 10;
  const drawHead = () => {
    const y = doc.y;
    doc.rect(left, y, width, 18).fill(BRAND);
    let x = left;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    columns.forEach((column, i) => {
      doc.text(column.header, x + 4, y + 5, { width: widths[i] - 8, align: column.align ?? 'left', lineBreak: false });
      x += widths[i];
    });
    doc.y = y + 18;
  };
  drawHead();
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('No records match the selected filters.', left, doc.y + 8, { width, align: 'center' });
    return;
  }
  rows.forEach((row, rowIndex) => {
    doc.font('Helvetica').fontSize(8);
    const cells = columns.map((column) => String(column.format ? column.format(row[column.key], row) : row[column.key] ?? ''));
    const height = Math.max(16, ...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - 8 }) + 7));
    if (doc.y + height > bottomLimit()) {
      doc.addPage();
      header(doc, { ...context, subtitle: `${context.title} (continued)`, title: '', filters: null });
      drawHead();
      doc.font('Helvetica').fontSize(8);
    }
    const y = doc.y;
    if (rowIndex % 2 === 1) doc.rect(left, y, width, height).fill(STRIPE);
    let x = left;
    doc.fillColor('#111111');
    cells.forEach((cell, i) => {
      doc.text(cell, x + 4, y + 4, { width: widths[i] - 8, align: columns[i].align ?? 'left' });
      x += widths[i];
    });
    doc.y = y + height;
  });
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
}

function summary(doc, items) {
  if (!items?.length) return;
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  if (doc.y + 20 + items.length * 14 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(0.8);
  const boxWidth = 240, x = left + width - boxWidth;
  for (const [label, value, strong] of items) {
    const y = doc.y;
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10 : 9).fillColor(strong ? BRAND : '#111111');
    doc.text(label, x, y, { width: boxWidth - 100, lineBreak: false });
    doc.text(value, x + boxWidth - 100, y, { width: 100, align: 'right', lineBreak: false });
    doc.y = y + (strong ? 16 : 13);
  }
}

function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function newDocument(meta, landscape) {
  return new PDFDocument({
    size: 'A4', layout: landscape ? 'landscape' : 'portrait', bufferPages: true,
    margins: { top: 36, left: 40, right: 40, bottom: 48 },
    info: { Title: meta.title, Author: meta.company.name, Creator: 'Garage Management System', CreationDate: meta.generatedAt },
  });
}

/** Tabular report: header, filter summary, striped table, totals block and page footers. */
export async function renderReport({ company, title, subtitle, filters, columns, rows, totals, generatedBy, generatedAt = new Date(), landscape = false }) {
  const meta = { company, title, generatedAt };
  const doc = newDocument(meta, landscape);
  header(doc, { company, title, subtitle, filters });
  table(doc, columns, rows, { company, title });
  summary(doc, totals);
  footers(doc, { generatedAt, generatedBy, company });
  return finish(doc);
}

/** Customer invoice document built from the immutable invoice snapshot. */
export async function renderInvoice({ company, invoice, customer, vehicle, payments, generatedBy, generatedAt = new Date() }) {
  const title = `Invoice INV-${String(invoice.invoice_id).padStart(5, '0')}`;
  const doc = newDocument({ company, title, generatedAt }, false);
  header(doc, { company, title, subtitle: `Issued ${nairobiTime(invoice.issued_at)}  •  Job card #${invoice.job_card_id}  •  Status: ${invoice.payment_status.replace('_', ' ')}` });
  const left = doc.page.margins.left;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text('BILL TO', left, y);
  doc.font('Helvetica').fontSize(9).fillColor('#111111').text([customer?.name, customer?.phone, customer?.email].filter(Boolean).join('\n'), left, doc.y + 2, { width: 240 });
  const afterCustomer = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND).text('VEHICLE', left + 280, y);
  doc.font('Helvetica').fontSize(9).fillColor('#111111').text([vehicle?.registration_no, [vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(' ')].filter(Boolean).join('\n'), left + 280, doc.y + 2, { width: 220 });
  doc.y = Math.max(afterCustomer, doc.y) + 14;
  table(doc, [
    { header: 'Type', key: 'kind', width: 0.8 },
    { header: 'Description', key: 'description', width: 3 },
    { header: 'Qty / Hours', key: 'quantity', width: 1, align: 'right' },
    { header: 'Unit price (KES)', key: 'unit_price', width: 1.3, align: 'right', format: money },
    { header: 'Amount (KES)', key: 'line_total', width: 1.3, align: 'right', format: money },
  ], invoice.lines, { company, title });
  summary(doc, [
    ['Total', `KES ${money(invoice.total_amount)}`, true],
    ['Amount paid', `KES ${money(invoice.amount_paid)}`],
    ['Balance due', `KES ${money(invoice.balance_due)}`, true],
  ]);
  if (payments?.length) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND).text('Payments received', left);
    doc.moveDown(0.3);
    table(doc, [
      { header: 'Date', key: 'paid_at', width: 1.5, format: (value) => nairobiTime(value) },
      { header: 'Method', key: 'method', width: 1.2, format: (value) => String(value).replace('_', ' ') },
      { header: 'Reference', key: 'transaction_reference', width: 2 },
      { header: 'Amount (KES)', key: 'amount', width: 1.2, align: 'right', format: money },
    ], payments, { company, title });
  }
  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Thank you for your business. Pay by M-Pesa, card, bank transfer or cash at the front desk; quote the invoice number as your reference.', left);
  footers(doc, { generatedAt, generatedBy, company });
  return finish(doc);
}
