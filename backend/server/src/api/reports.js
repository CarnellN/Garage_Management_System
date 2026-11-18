// Management reports (PDF or JSON) with date-range filters, allowlisted sorting and audit logging.
import { project } from './contract.js';
import { invalid, missing } from './resources.js';
import { invoiceFor, invoiceView, cents, decimal } from './workflows.js';
import { renderReport, renderInvoice, nairobiTime, money } from '../reports/pdf.js';

const MAX_ROWS = 5000;
const DAY = 86400000;
const toDate = (value) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
// API timestamps are RFC 3339 UTC, matching the rest of the contract.
const isoRows = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.endsWith('_at') && value ? toDate(value instanceof Date ? value.toISOString() : String(value)).toISOString() : value])));
const label = (value) => String(value ?? '').replaceAll('_', ' ');

/** Resolves from/to with a default window and an upper bound so a report can never scan unbounded history. */
function range(query, { defaultDays = 30, required = true } = {}) {
  if (!required && !query.from && !query.to) return null;
  const to = query.to ? toDate(query.to) : new Date();
  const from = query.from ? toDate(query.from) : new Date(+to - defaultDays * DAY);
  if (to <= from) invalid('The report end date must be after its start date.');
  if (to - from > 366 * DAY) invalid('Reports cover at most 366 days. Narrow the date range.');
  return { from, to };
}
const describeRange = (window) => window ? `${nairobiTime(window.from, false)} – ${nairobiTime(new Date(+window.to - 1), false)}` : 'All dates';

export function reportHandlers({ company, logger = console } = {}) {
  const brand = {
    name: company?.name ?? 'Garage Management System',
    address: company?.address, phone: company?.phone, email: company?.email, logoFile: company?.logoFile,
  };
  brand.initials = brand.name.split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0].toUpperCase()).join('') || 'GMS';

  async function deliver(req, s, report) {
    // Report exports contain business data, so each generation is recorded in the audit trail.
    try {
      await s.insert('AUDIT_EVENT', { actor_user_id: req.user.user_id, action: req.operation.operationId, resource_type: 'Reports', resource_id: report.auditResource ?? null, occurred_at: new Date(), request_id: req.requestId, outcome: 'SUCCESS' });
    } catch { logger.error({ event: 'audit_write_failed', request_id: req.requestId }); }
    const generatedAt = new Date();
    if ((req.input.query.format ?? 'pdf') === 'json') {
      if (report.jsonBody) return { status: 200, body: report.jsonBody };
      return { status: 200, body: { title: report.title, company: brand.name, generated_at: generatedAt.toISOString(), filters: report.filters, items: isoRows(report.rows), totals: Object.fromEntries((report.totals ?? []).map(([key, value]) => [key, value])) } };
    }
    const raw = report.render
      ? await report.render({ generatedAt, generatedBy: req.user.name })
      : await renderReport({ company: brand, title: report.title, subtitle: report.subtitle, filters: report.filters, columns: report.columns, rows: report.rows, totals: report.totals, landscape: report.landscape, generatedBy: `${req.user.name} (${label(req.user.role)})`, generatedAt });
    const file = `${report.file}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
    return { status: 200, raw, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file}"` } };
  }
  const order = (q, columns, fallback) => {
    const column = columns[q.sort ?? fallback];
    if (!column) invalid('Unsupported sort column.');
    return `${column} ${q.order === 'desc' ? 'DESC' : 'ASC'}`;
  };

  return {
    async getRevenueReport(req, s) {
      const q = req.input.query, i = s.ident, window = range(q), b = s.build();
      const where = [`p.${i('paid_at')} >= ${b.bind(window.from)}`, `p.${i('paid_at')} < ${b.bind(window.to)}`];
      if (q.method) where.push(`p.${i('method')} = ${b.bind(q.method)}`);
      const sort = order(q, { paid_at: `p.${i('paid_at')}`, amount: `p.${i('amount')}`, method: `p.${i('method')}`, customer: `c.${i('name')}` }, 'paid_at');
      const rows = (await s.db.query(`SELECT p.${i('payment_id')}, p.${i('paid_at')}, p.${i('amount')}, p.${i('method')}, p.${i('transaction_reference')}, p.${i('invoice_id')}, v.${i('registration_no')}, c.${i('name')} AS customer_name
        FROM ${i('PAYMENT')} p JOIN ${i('INVOICE')} n ON n.${i('invoice_id')} = p.${i('invoice_id')} JOIN ${i('JOB_CARD')} j ON j.${i('job_card_id')} = n.${i('job_card_id')}
        JOIN ${i('VEHICLE')} v ON v.${i('vehicle_id')} = j.${i('vehicle_id')} JOIN ${i('CUSTOMER')} c ON c.${i('customer_id')} = v.${i('customer_id')}
        WHERE ${where.join(' AND ')} ORDER BY ${sort}, p.${i('payment_id')} LIMIT ${MAX_ROWS}`, b.values)).rows;
      const byMethod = {};
      let total = 0n;
      for (const row of rows) { total += cents(row.amount); byMethod[row.method] = (byMethod[row.method] ?? 0n) + cents(row.amount); }
      return deliver(req, s, {
        title: 'Revenue Report', file: 'revenue-report', subtitle: `${rows.length} payment(s) received`,
        filters: [`Period: ${describeRange(window)}`, `Method: ${q.method ? label(q.method) : 'All'}`, `Sorted by: ${q.sort ?? 'paid_at'} ${q.order ?? 'asc'}`],
        columns: [
          { header: 'Date paid', key: 'paid_at', width: 1.5, format: (v) => nairobiTime(v) },
          { header: 'Invoice', key: 'invoice_id', width: 0.8, format: (v) => `INV-${String(v).padStart(5, '0')}` },
          { header: 'Customer', key: 'customer_name', width: 1.8 },
          { header: 'Vehicle', key: 'registration_no', width: 1.1 },
          { header: 'Method', key: 'method', width: 1.2, format: label },
          { header: 'Reference', key: 'transaction_reference', width: 1.6 },
          { header: 'Amount (KES)', key: 'amount', width: 1.2, align: 'right', format: money },
        ],
        rows, landscape: true,
        totals: [...Object.entries(byMethod).map(([method, value]) => [label(method), `KES ${money(decimal(value))}`]), ['Total revenue', `KES ${money(decimal(total))}`, true]],
      });
    },

    async getBookingReport(req, s) {
      const q = req.input.query, i = s.ident, window = range(q), b = s.build();
      const where = [`k.${i('scheduled_at')} >= ${b.bind(window.from)}`, `k.${i('scheduled_at')} < ${b.bind(window.to)}`];
      if (q.status) where.push(`k.${i('status')} = ${b.bind(q.status)}`);
      const sort = order(q, { scheduled_at: `k.${i('scheduled_at')}`, status: `k.${i('status')}`, customer: `c.${i('name')}`, bay: `y.${i('name')}` }, 'scheduled_at');
      const rows = (await s.db.query(`SELECT k.${i('booking_id')}, k.${i('scheduled_at')}, k.${i('ends_at')}, k.${i('status')}, y.${i('name')} AS bay_name, v.${i('registration_no')}, c.${i('name')} AS customer_name, c.${i('phone')}
        FROM ${i('BOOKING')} k JOIN ${i('VEHICLE')} v ON v.${i('vehicle_id')} = k.${i('vehicle_id')} JOIN ${i('CUSTOMER')} c ON c.${i('customer_id')} = v.${i('customer_id')}
        JOIN ${i('BAY')} y ON y.${i('bay_id')} = k.${i('bay_id')} WHERE ${where.join(' AND ')} ORDER BY ${sort}, k.${i('booking_id')} LIMIT ${MAX_ROWS}`, b.values)).rows;
      const counts = {};
      for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
      return deliver(req, s, {
        title: 'Bookings Report', file: 'bookings-report', subtitle: `${rows.length} appointment(s)`,
        filters: [`Period: ${describeRange(window)}`, `Status: ${q.status ? label(q.status) : 'All'}`, `Sorted by: ${q.sort ?? 'scheduled_at'} ${q.order ?? 'asc'}`],
        columns: [
          { header: '#', key: 'booking_id', width: 0.5 },
          { header: 'Starts', key: 'scheduled_at', width: 1.4, format: (v) => nairobiTime(v) },
          { header: 'Ends', key: 'ends_at', width: 1.4, format: (v) => nairobiTime(v) },
          { header: 'Bay', key: 'bay_name', width: 1.6 },
          { header: 'Vehicle', key: 'registration_no', width: 1 },
          { header: 'Customer', key: 'customer_name', width: 1.6 },
          { header: 'Phone', key: 'phone', width: 1.2 },
          { header: 'Status', key: 'status', width: 1, format: label },
        ],
        rows, landscape: true,
        totals: [...Object.entries(counts).map(([status, count]) => [label(status), String(count)]), ['Total bookings', String(rows.length), true]],
      });
    },

    async getJobReport(req, s) {
      const q = req.input.query, i = s.ident, window = range(q), b = s.build();
      const where = [`j.${i('opened_at')} >= ${b.bind(window.from)}`, `j.${i('opened_at')} < ${b.bind(window.to)}`];
      if (q.status) where.push(`j.${i('status')} = ${b.bind(q.status)}`);
      // Mechanics only ever see their own assignments, whatever filter they request.
      const mechanicId = req.user.role === 'MECHANIC' ? req.user.user_id : q.mechanic_id;
      if (req.user.role === 'MECHANIC' && q.mechanic_id && q.mechanic_id !== req.user.user_id) missing();
      if (mechanicId) where.push(`j.${i('mechanic_id')} = ${b.bind(mechanicId)}`);
      const sort = order(q, { opened_at: `j.${i('opened_at')}`, status: `j.${i('status')}`, mechanic: `u.${i('name')}`, customer: `c.${i('name')}` }, 'opened_at');
      const rows = (await s.db.query(`SELECT j.${i('job_card_id')}, j.${i('opened_at')}, j.${i('status')}, v.${i('registration_no')}, c.${i('name')} AS customer_name, u.${i('name')} AS mechanic_name,
          (SELECT COALESCE(SUM(t.${i('standard_hours')}), 0) FROM ${i('TASK')} t WHERE t.${i('job_card_id')} = j.${i('job_card_id')}) AS labour_hours,
          (SELECT COUNT(*) FROM ${i('TASK')} t WHERE t.${i('job_card_id')} = j.${i('job_card_id')}) AS task_count,
          (SELECT COALESCE(SUM(jp.${i('quantity')} * jp.${i('unit_price_snapshot')}), 0) FROM ${i('JOB_PART')} jp WHERE jp.${i('job_card_id')} = j.${i('job_card_id')}) AS parts_value
        FROM ${i('JOB_CARD')} j JOIN ${i('VEHICLE')} v ON v.${i('vehicle_id')} = j.${i('vehicle_id')} JOIN ${i('CUSTOMER')} c ON c.${i('customer_id')} = v.${i('customer_id')}
        JOIN ${i('USER')} u ON u.${i('user_id')} = j.${i('mechanic_id')} WHERE ${where.join(' AND ')} ORDER BY ${sort}, j.${i('job_card_id')} LIMIT ${MAX_ROWS}`, b.values)).rows
        .map((row) => ({ ...row, task_count: Number(row.task_count), labour_hours: Number(row.labour_hours).toFixed(2), parts_value: Number(row.parts_value).toFixed(2) }));
      const hours = rows.reduce((sum, row) => sum + Number(row.labour_hours), 0);
      const parts = rows.reduce((sum, row) => sum + cents(row.parts_value), 0n);
      return deliver(req, s, {
        title: 'Job Cards Report', file: 'job-cards-report', subtitle: `${rows.length} job card(s)`,
        filters: [`Period opened: ${describeRange(window)}`, `Status: ${q.status ? label(q.status) : 'All'}`, `Mechanic: ${mechanicId ? (rows[0]?.mechanic_name ?? `#${mechanicId}`) : 'All'}`, `Sorted by: ${q.sort ?? 'opened_at'} ${q.order ?? 'asc'}`],
        columns: [
          { header: 'Job', key: 'job_card_id', width: 0.5 },
          { header: 'Opened', key: 'opened_at', width: 1.4, format: (v) => nairobiTime(v) },
          { header: 'Vehicle', key: 'registration_no', width: 1 },
          { header: 'Customer', key: 'customer_name', width: 1.6 },
          { header: 'Mechanic', key: 'mechanic_name', width: 1.5 },
          { header: 'Status', key: 'status', width: 1.2, format: label },
          { header: 'Tasks', key: 'task_count', width: 0.6, align: 'right' },
          { header: 'Labour hrs', key: 'labour_hours', width: 0.9, align: 'right' },
          { header: 'Parts (KES)', key: 'parts_value', width: 1.1, align: 'right', format: money },
        ],
        rows, landscape: true,
        totals: [['Labour hours', hours.toFixed(2)], ['Parts value', `KES ${money(decimal(parts))}`], ['Total job cards', String(rows.length), true]],
      });
    },

    async getOutstandingInvoicesReport(req, s) {
      const q = req.input.query, i = s.ident, window = range(q, { required: false }), b = s.build();
      const paid = `COALESCE((SELECT SUM(p.${i('amount')}) FROM ${i('PAYMENT')} p WHERE p.${i('invoice_id')} = n.${i('invoice_id')}), 0)`;
      const where = [`${paid} < n.${i('total_amount')}`];
      if (window) where.push(`n.${i('issued_at')} >= ${b.bind(window.from)}`, `n.${i('issued_at')} < ${b.bind(window.to)}`);
      const sort = order(q, { issued_at: `n.${i('issued_at')}`, balance: `(n.${i('total_amount')} - ${paid})`, customer: `c.${i('name')}` }, 'issued_at');
      const rows = (await s.db.query(`SELECT n.${i('invoice_id')}, n.${i('issued_at')}, n.${i('total_amount')}, ${paid} AS amount_paid, c.${i('name')} AS customer_name, c.${i('phone')}, v.${i('registration_no')}
        FROM ${i('INVOICE')} n JOIN ${i('JOB_CARD')} j ON j.${i('job_card_id')} = n.${i('job_card_id')} JOIN ${i('VEHICLE')} v ON v.${i('vehicle_id')} = j.${i('vehicle_id')}
        JOIN ${i('CUSTOMER')} c ON c.${i('customer_id')} = v.${i('customer_id')} WHERE ${where.join(' AND ')} ORDER BY ${sort}, n.${i('invoice_id')} LIMIT ${MAX_ROWS}`, b.values)).rows
        .map((row) => {
          const amountPaid = cents(Number(row.amount_paid).toFixed(2));
          return { ...row, amount_paid: decimal(amountPaid), balance_due: decimal(cents(row.total_amount) - amountPaid) };
        });
      const outstanding = rows.reduce((sum, row) => sum + cents(row.balance_due), 0n);
      return deliver(req, s, {
        title: 'Outstanding Invoices Report', file: 'outstanding-invoices', subtitle: `${rows.length} unpaid or part-paid invoice(s) as at ${nairobiTime(new Date())}`,
        filters: [`Issued: ${describeRange(window)}`, `Sorted by: ${q.sort ?? 'issued_at'} ${q.order ?? 'asc'}`],
        columns: [
          { header: 'Invoice', key: 'invoice_id', width: 0.9, format: (v) => `INV-${String(v).padStart(5, '0')}` },
          { header: 'Issued', key: 'issued_at', width: 1.3, format: (v) => nairobiTime(v) },
          { header: 'Customer', key: 'customer_name', width: 1.7 },
          { header: 'Phone', key: 'phone', width: 1.2 },
          { header: 'Vehicle', key: 'registration_no', width: 1 },
          { header: 'Total (KES)', key: 'total_amount', width: 1.1, align: 'right', format: money },
          { header: 'Paid (KES)', key: 'amount_paid', width: 1.1, align: 'right', format: money },
          { header: 'Balance (KES)', key: 'balance_due', width: 1.1, align: 'right', format: money },
        ],
        rows, landscape: true,
        totals: [['Invoices', String(rows.length)], ['Total outstanding', `KES ${money(decimal(outstanding))}`, true]],
      });
    },

    async getAuditReport(req, s) {
      const q = req.input.query, i = s.ident, window = range(q, { defaultDays: 7 }), b = s.build();
      const where = [`a.${i('occurred_at')} >= ${b.bind(window.from)}`, `a.${i('occurred_at')} < ${b.bind(window.to)}`];
      if (q.actor_user_id) where.push(`a.${i('actor_user_id')} = ${b.bind(q.actor_user_id)}`);
      if (q.outcome) where.push(`a.${i('outcome')} = ${b.bind(q.outcome)}`);
      const sort = order(q, { occurred_at: `a.${i('occurred_at')}`, actor: `u.${i('name')}`, action: `a.${i('action')}` }, 'occurred_at');
      const rows = (await s.db.query(`SELECT a.${i('audit_id')}, a.${i('occurred_at')}, a.${i('action')}, a.${i('resource_type')}, a.${i('resource_id')}, a.${i('outcome')}, a.${i('request_id')}, u.${i('name')} AS actor_name, u.${i('role')}
        FROM ${i('AUDIT_EVENT')} a LEFT JOIN ${i('USER')} u ON u.${i('user_id')} = a.${i('actor_user_id')} WHERE ${where.join(' AND ')} ORDER BY ${sort}, a.${i('audit_id')} LIMIT ${MAX_ROWS}`, b.values)).rows;
      const counts = {};
      for (const row of rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
      return deliver(req, s, {
        title: 'Audit Trail Report', file: 'audit-trail', subtitle: `${rows.length} event(s): who did what, and when`,
        filters: [`Period: ${describeRange(window)}`, `Outcome: ${q.outcome ?? 'All'}`, `Actor: ${q.actor_user_id ? `#${q.actor_user_id}` : 'All'}`],
        columns: [
          { header: 'When', key: 'occurred_at', width: 1.3, format: (v) => nairobiTime(v) },
          { header: 'Who', key: 'actor_name', width: 1.5, format: (v, row) => v ? `${v} (${label(row.role)})` : 'System / anonymous' },
          { header: 'Action', key: 'action', width: 1.7 },
          { header: 'Resource', key: 'resource_type', width: 1.2, format: (v, row) => row.resource_id ? `${v} #${row.resource_id}` : v },
          { header: 'Outcome', key: 'outcome', width: 0.8 },
          { header: 'Request ID', key: 'request_id', width: 2.2 },
        ],
        rows, landscape: true,
        totals: [...Object.entries(counts).map(([outcome, count]) => [outcome, String(count)]), ['Total events', String(rows.length), true]],
      });
    },

    async getInvoicePdf(req, s) {
      const invoice = await invoiceView(s, await invoiceFor(s, req, req.input.params.invoiceId));
      const job = await s.find('JOB_CARD', { job_card_id: invoice.job_card_id });
      const vehicle = await s.find('VEHICLE', { vehicle_id: job.vehicle_id });
      const customer = await s.find('CUSTOMER', { customer_id: vehicle.customer_id });
      const payments = (await s.db.query(`SELECT * FROM ${s.ident('PAYMENT')} WHERE ${s.ident('invoice_id')} = ? ORDER BY ${s.ident('payment_id')}`, [invoice.invoice_id])).rows.map((row) => project('Payment', row));
      return deliver(req, s, {
        title: `Invoice INV-${String(invoice.invoice_id).padStart(5, '0')}`, file: `invoice-${invoice.invoice_id}`, auditResource: String(invoice.invoice_id),
        filters: [], jsonBody: { invoice, customer: customer && project('Customer', customer), vehicle: project('Vehicle', vehicle), payments },
        render: ({ generatedAt, generatedBy }) => renderInvoice({ company: brand, invoice, customer, vehicle, payments, generatedAt, generatedBy }),
      });
    },
  };
}
