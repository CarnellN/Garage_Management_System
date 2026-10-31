import { HttpError } from '../errors.js';
import { project } from './contract.js';
import { reply, missing, conflict, invalid, ownedCustomer, vehicleFor, jobFor, assertVersion, editableJob, bumpJob } from './resources.js';

const ACTIVE = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];
const date = (value) => value instanceof Date ? value : new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
const cents = (value) => {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) invalid('Expected an exact decimal string with two fractional digits.');
  return BigInt(value.replace('.', ''));
};
const decimal = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
function totalDecimal(value) {
  if (value < 0n || value > 999999999999n) invalid('Amount exceeds the supported invoice total.');
  return decimal(value);
}
const tag = (row) => ({ ETag: `"${row.version}"` });
async function mechanic(store, id) {
  const user = await store.find('USER', { user_id: id }, { lock: true });
  if (!user || user.role !== 'MECHANIC' || !user.active) invalid('Assign an active mechanic account.');
}
async function bookingFor(store, req, id, lock = false) {
  const booking = await store.find('BOOKING', { booking_id: id }, { lock });
  if (!booking) missing();
  await vehicleFor(store, req, booking.vehicle_id);
  return booking;
}
function windowInput(start, end, { future = true, hours } = {}) {
  const from = date(start), to = date(end);
  if (+from % 1000 || +to % 1000) invalid('Appointment times must use whole seconds to match the database DATETIME precision.');
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from || to - from > 480 * 60000 || (future && from <= new Date())) invalid('Provide a future interval of up to 480 minutes with ends_at after scheduled_at.');
  if (!hours) throw new HttpError(503, 'SCHEDULE_NOT_CONFIGURED', 'Garage opening hours are not configured.');
  const localStart = new Date(+from + 3 * 3600000), localEnd = new Date(+to + 3 * 3600000);
  if (!hours.days.includes(localStart.getUTCDay()) || localStart.toISOString().slice(0, 10) !== localEnd.toISOString().slice(0, 10) ||
      localStart.getUTCHours() * 60 + localStart.getUTCMinutes() < hours.open ||
      localEnd.getUTCHours() * 60 + localEnd.getUTCMinutes() > hours.close ||
      (localEnd.getUTCHours() * 60 + localEnd.getUTCMinutes() === hours.close && (localEnd.getUTCSeconds() || localEnd.getUTCMilliseconds()))) invalid('The interval must fit configured Africa/Nairobi opening hours.');
  return { from, to };
}
async function reserve(store, vehicleId, from, to, excludeId) {
  // All reservations lock vehicle then every enabled bay in ID order. Overlap reads are current locking reads.
  await store.find('VEHICLE', { vehicle_id: vehicleId }, { lock: true });
  const { ident: i } = store;
  const bays = (await store.db.query(`SELECT * FROM ${i('BAY')} WHERE ${i('enabled')} = TRUE ORDER BY ${i('bay_id')} FOR UPDATE`)).rows;
  if (!bays.length) conflict('No enabled service bays are available.');
  const b = store.build();
  const sql = `SELECT * FROM ${i('BOOKING')} WHERE ${i('status')} IN ('PENDING','CONFIRMED','CHECKED_IN') AND ${i('scheduled_at')} < ${b.bind(to)} AND ${i('ends_at')} > ${b.bind(from)}${excludeId ? ` AND ${i('booking_id')} <> ${b.bind(excludeId)}` : ''} FOR UPDATE`;
  const overlapping = (await store.db.query(sql, b.values)).rows;
  const bay = bays.find((candidate) => !overlapping.some((row) => Number(row.bay_id) === Number(candidate.bay_id)));
  if (!bay || overlapping.some((row) => Number(row.vehicle_id) === Number(vehicleId))) throw new HttpError(409, 'BOOKING_CONFLICT', 'The vehicle or garage capacity is already reserved for this interval.');
  return bay.bay_id;
}

async function scopedList(req, store, table, id, schema, filters = {}) {
  const i = store.ident, b = store.build(), q = req.input.query;
  const job = table === 'JOB_CARD';
  const invoice = table === 'INVOICE';
  let join = '';
  if (invoice) join += ` JOIN ${i('JOB_CARD')} j ON j.${i('job_card_id')} = r.${i('job_card_id')}`;
  join += ` JOIN ${i('VEHICLE')} v ON v.${i('vehicle_id')} = ${invoice ? 'j' : 'r'}.${i('vehicle_id')}`;
  const conditions = ['1 = 1'];
  if (req.user.role === 'CUSTOMER') conditions.push(`v.${i('customer_id')} = ${b.bind(req.user.customer_id)}`);
  if (job && req.user.role === 'MECHANIC') conditions.push(`r.${i('mechanic_id')} = ${b.bind(req.user.user_id)}`);
  if (q.customer_id) {
    ownedCustomer(req, q.customer_id);
    if (!await store.find('CUSTOMER', { customer_id: q.customer_id })) missing();
    conditions.push(`v.${i('customer_id')} = ${b.bind(q.customer_id)}`);
  }
  if (q.vehicle_id) {
    await vehicleFor(store, req, q.vehicle_id);
    if (job && req.user.role === 'MECHANIC' && !await store.find('JOB_CARD', { vehicle_id: q.vehicle_id, mechanic_id: req.user.user_id })) missing();
  }
  if (q.job_card_id) await jobFor(store, req, q.job_card_id);
  if (job && req.user.role === 'MECHANIC' && q.mechanic_id && q.mechanic_id !== req.user.user_id) missing();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) conditions.push(`r.${i(key)} = ${b.bind(value)}`);
  if (q.from && q.to && (date(q.to) <= date(q.from) || date(q.to) - date(q.from) > 31 * 86400000)) invalid('Date range must be ordered and at most 31 days.');
  if (q.from) conditions.push(`r.${i('scheduled_at')} >= ${b.bind(date(q.from))}`);
  if (q.to) conditions.push(`r.${i('scheduled_at')} < ${b.bind(date(q.to))}`);
  const base = `FROM ${i(table)} r${join} WHERE ${conditions.join(' AND ')}`;
  const count = await store.db.query(`SELECT COUNT(*) AS total ${base}`, b.values);
  const page = q.page ?? 1, page_size = q.page_size ?? 20;
  const order = table === 'BOOKING' ? `r.${i('scheduled_at')}, r.${i(id)}` : `r.${i(id)}`;
  const result = await store.db.query(`SELECT r.* ${base} ORDER BY ${order} LIMIT ${page_size} OFFSET ${(page - 1) * page_size}`, b.values);
  return { items: result.rows, pagination: { page, page_size, total: Number(count.rows[0].total) } };
}

async function invoiceFor(store, req, id, lock = false) {
  const invoice = await store.find('INVOICE', { invoice_id: id }, { lock });
  if (!invoice) missing();
  await jobFor(store, req, invoice.job_card_id);
  return invoice;
}
async function invoiceView(store, invoice, lockPayments = false) {
  const i = store.ident, marker = store.db.driver === 'postgres' ? '$1' : '?';
  const payments = await store.db.query(`SELECT ${i('amount')} FROM ${i('PAYMENT')} WHERE ${i('invoice_id')} = ${marker}${lockPayments ? ' FOR UPDATE' : ''}`, [invoice.invoice_id]);
  const lines = await store.db.query(`SELECT ${i('kind')}, ${i('description')}, ${i('quantity')}, ${i('unit_price')}, ${i('line_total')} FROM ${i('INVOICE_LINE')} WHERE ${i('invoice_id')} = ${marker} ORDER BY ${i('invoice_line_id')}`, [invoice.invoice_id]);
  const amount = payments.rows.reduce((sum, payment) => sum + cents(payment.amount), 0n);
  const balance = cents(invoice.total_amount) - amount;
  if (balance < 0n) throw new Error('Stored payments exceed the invoice total.');
  return project('Invoice', { ...invoice, currency: 'KES', lines: lines.rows, amount_paid: decimal(amount), balance_due: decimal(balance), payment_status: balance === 0n ? 'PAID' : amount > 0n ? 'PARTIALLY_PAID' : 'UNPAID' });
}

export function workflowHandlers({ schedule, laborRate } = {}) {
  const h = {};
  h.listBookings = async (req, s) => reply(project('BookingList', await scopedList(req, s, 'BOOKING', 'booking_id', 'Booking', { vehicle_id: req.input.query.vehicle_id, status: req.input.query.status })));
  h.getBooking = async (req, s) => { const row = await bookingFor(s, req, req.input.params.bookingId); return reply(project('Booking', row), 200, tag(row)); };
  h.createBooking = async (req, s) => {
    await vehicleFor(s, req, req.body.vehicle_id, true);
    const { from, to } = windowInput(req.body.scheduled_at, req.body.ends_at, { hours: schedule });
    const bay_id = await reserve(s, req.body.vehicle_id, from, to);
    const id = await s.insert('BOOKING', { vehicle_id: req.body.vehicle_id, scheduled_at: from, ends_at: to, bay_id, status: 'PENDING', version: 1 }, 'booking_id');
    return reply(project('Booking', await s.find('BOOKING', { booking_id: id })), 201, { Location: `/api/v1/bookings/${id}`, ETag: '"1"' });
  };
  h.rescheduleBooking = async (req, s) => {
    const row = await bookingFor(s, req, req.input.params.bookingId, true);
    assertVersion(req, row);
    if (!['PENDING', 'CONFIRMED'].includes(row.status)) conflict('Only pending or confirmed bookings may be rescheduled.');
    const { from, to } = windowInput(req.body.scheduled_at, req.body.ends_at, { hours: schedule });
    const bay_id = await reserve(s, row.vehicle_id, from, to, row.booking_id);
    await s.update('BOOKING', { booking_id: row.booking_id }, { scheduled_at: from, ends_at: to, bay_id, version: Number(row.version) + 1 });
    return h.getBooking(req, s);
  };
  h.updateBookingStatus = async (req, s) => {
    const row = await bookingFor(s, req, req.input.params.bookingId, true);
    assertVersion(req, row);
    const next = req.body.status;
    if (req.user.role === 'CUSTOMER' && (next !== 'CANCELLED' || date(row.scheduled_at) <= new Date())) conflict('Customers may cancel only before the appointment starts.');
    const allowed = { PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['CANCELLED', 'NO_SHOW'] };
    if (!allowed[row.status]?.includes(next) || (next === 'NO_SHOW' && date(row.scheduled_at) > new Date())) conflict('This booking status transition is not allowed.');
    await s.update('BOOKING', { booking_id: row.booking_id }, { status: next, version: Number(row.version) + 1 });
    return h.getBooking(req, s);
  };
  h.listAvailability = async (req, s) => {
    const q = req.input.query, from = date(q.from), to = date(q.to), duration = q.duration_minutes ?? 60;
    if (to <= from || to - from > 31 * 86400000) invalid('Availability range must be ordered and at most 31 days.');
    if (!schedule) throw new HttpError(503, 'SCHEDULE_NOT_CONFIGURED', 'Garage opening hours are not configured.');
    if (q.vehicle_id) await vehicleFor(s, req, q.vehicle_id);
    const i = s.ident, b = s.build();
    const bays = (await s.db.query(`SELECT ${i('bay_id')} FROM ${i('BAY')} WHERE ${i('enabled')} = TRUE`)).rows;
    const bookings = (await s.db.query(`SELECT * FROM ${i('BOOKING')} WHERE ${i('status')} IN ('PENDING','CONFIRMED','CHECKED_IN') AND ${i('scheduled_at')} < ${b.bind(to)} AND ${i('ends_at')} > ${b.bind(from)}`, b.values)).rows;
    const slots = [];
    const first = Math.ceil(Math.max(+from, Date.now()) / 900000) * 900000;
    for (let start = first; start + duration * 60000 <= +to; start += 900000) {
      const end = start + duration * 60000;
      try { windowInput(new Date(start), new Date(end), { hours: schedule }); } catch (error) { if (error.status === 422) continue; throw error; }
      const overlaps = bookings.filter((row) => +date(row.scheduled_at) < end && +date(row.ends_at) > start);
      if (q.vehicle_id && overlaps.some((row) => Number(row.vehicle_id) === q.vehicle_id)) continue;
      const available_bays = bays.filter((bay) => !overlaps.some((row) => Number(row.bay_id) === Number(bay.bay_id))).length;
      if (available_bays) slots.push({ scheduled_at: new Date(start), ends_at: new Date(end), available_bays });
    }
    const page = q.page ?? 1, page_size = q.page_size ?? 20;
    return reply(project('AvailabilitySlotList', { items: slots.slice((page - 1) * page_size, page * page_size), pagination: { page, page_size, total: slots.length } }));
  };

  h.listJobCards = async (req, s) => reply(project('JobCardList', await scopedList(req, s, 'JOB_CARD', 'job_card_id', 'JobCard', { vehicle_id: req.input.query.vehicle_id, mechanic_id: req.input.query.mechanic_id, status: req.input.query.status })));
  h.getJobCard = async (req, s) => { const row = await jobFor(s, req, req.input.params.jobCardId); return reply(project('JobCard', row), 200, tag(row)); };
  h.createJobCard = async (req, s) => {
    await vehicleFor(s, req, req.body.vehicle_id, true);
    await mechanic(s, req.body.mechanic_id);
    if (await s.find('JOB_CARD', { vehicle_id: req.body.vehicle_id, status: ['OPEN', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETED'] }, { lock: true })) conflict('The vehicle already has an active job.');
    if (req.body.booking_id) {
      const booking = await bookingFor(s, req, req.body.booking_id, true);
      if (Number(booking.vehicle_id) !== req.body.vehicle_id || booking.status !== 'CONFIRMED') invalid('The linked booking must be confirmed for the same vehicle.');
      if (await s.find('JOB_CARD', { booking_id: booking.booking_id }, { lock: true })) conflict('This booking already has a job card.');
      await s.update('BOOKING', { booking_id: booking.booking_id }, { status: 'CHECKED_IN', version: Number(booking.version) + 1 });
    }
    const id = await s.insert('JOB_CARD', { ...req.body, booking_id: req.body.booking_id ?? null, opened_at: new Date(), status: 'OPEN', version: 1 }, 'job_card_id');
    return reply(project('JobCard', await s.find('JOB_CARD', { job_card_id: id })), 201, { Location: `/api/v1/job-cards/${id}`, ETag: '"1"' });
  };
  h.assignMechanic = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true);
    editableJob(req, job);
    await mechanic(s, req.body.mechanic_id);
    await s.update('JOB_CARD', { job_card_id: job.job_card_id }, { mechanic_id: req.body.mechanic_id });
    await bumpJob(s, job);
    return h.getJobCard(req, s);
  };
  h.updateJobCardStatus = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true);
    assertVersion(req, job);
    const next = req.body.status;
    const transitions = { OPEN: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['AWAITING_PARTS', 'COMPLETED', 'CANCELLED'], AWAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'], COMPLETED: ['CLOSED'] };
    if (!transitions[job.status]?.includes(next)) conflict('This job status transition is not allowed.');
    if (req.user.role === 'MECHANIC' && ['CANCELLED', 'CLOSED'].includes(next)) throw new HttpError(403, 'FORBIDDEN', 'Only receptionists and admins can cancel or close jobs.');
    if (next === 'COMPLETED') {
      const i = s.ident, b = s.build();
      const tasks = (await s.db.query(`SELECT * FROM ${i('TASK')} WHERE ${i('job_card_id')} = ${b.bind(job.job_card_id)} FOR UPDATE`, b.values)).rows;
      if (!tasks.length || tasks.some((task) => task.standard_hours === null)) conflict('Completion requires at least one task and standard hours on every task.');
    }
    if (next === 'CANCELLED' && (await s.find('TASK', { job_card_id: job.job_card_id }) || await s.find('JOB_PART', { job_card_id: job.job_card_id }))) conflict('Remove tasks and parts before cancellation.');
    if (next === 'CLOSED') {
      const invoice = await s.find('INVOICE', { job_card_id: job.job_card_id }, { lock: true });
      if (!invoice || (await invoiceView(s, invoice, true)).balance_due !== '0.00') conflict('Closing requires a fully paid invoice.');
    }
    await s.update('JOB_CARD', { job_card_id: job.job_card_id }, { status: next });
    await bumpJob(s, job);
    if (job.booking_id && ['COMPLETED', 'CANCELLED'].includes(next)) {
      const booking = await s.find('BOOKING', { booking_id: job.booking_id }, { lock: true });
      if (booking?.status !== 'CHECKED_IN') conflict('The linked booking is not checked in.');
      await s.update('BOOKING', { booking_id: booking.booking_id }, { status: next, version: Number(booking.version) + 1 });
    }
    return h.getJobCard(req, s);
  };

  h.listJobTasks = async (req, s) => { await jobFor(s, req, req.input.params.jobCardId); return reply(project('TaskList', await s.list('TASK', { job_card_id: req.input.params.jobCardId }, req.input.query))); };
  h.getJobTask = async (req, s) => {
    await jobFor(s, req, req.input.params.jobCardId);
    return reply(project('Task', await s.find('TASK', { job_card_id: req.input.params.jobCardId, task_id: req.input.params.taskId }) ?? missing()));
  };
  h.createJobTask = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true); editableJob(req, job);
    const task_id = await s.insert('TASK', { job_card_id: job.job_card_id, standard_hours: null, ...req.body, name: req.body.name.trim() }, 'task_id');
    const headers = await bumpJob(s, job);
    return reply(project('Task', await s.find('TASK', { task_id })), 201, { ...headers, Location: `/api/v1/job-cards/${job.job_card_id}/tasks/${task_id}` });
  };
  h.updateJobTask = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true); editableJob(req, job);
    const filter = { job_card_id: job.job_card_id, task_id: req.input.params.taskId };
    if (!await s.find('TASK', filter, { lock: true })) missing();
    await s.update('TASK', filter, req.body);
    const headers = await bumpJob(s, job);
    return reply(project('Task', await s.find('TASK', filter)), 200, headers);
  };
  h.deleteJobTask = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true); editableJob(req, job);
    const filter = { job_card_id: job.job_card_id, task_id: req.input.params.taskId };
    if (!await s.find('TASK', filter, { lock: true })) missing();
    await s.remove('TASK', filter);
    return reply(null, 204, await bumpJob(s, job));
  };
  h.listJobParts = async (req, s) => { await jobFor(s, req, req.input.params.jobCardId); return reply(project('JobPartList', await s.list('JOB_PART', { job_card_id: req.input.params.jobCardId }, req.input.query))); };
  h.setJobPartQuantity = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true); editableJob(req, job);
    const filter = { job_card_id: job.job_card_id, part_id: req.input.params.partId };
    const previous = await s.find('JOB_PART', filter, { lock: true });
    if (previous) await s.update('JOB_PART', filter, req.body);
    else {
      const part = await s.find('PART', { part_id: filter.part_id }, { lock: true });
      if (!part) missing();
      if (part.unit_price === null) invalid('Configure the part price before recording usage.');
      await s.insert('JOB_PART', { ...filter, ...req.body, unit_price_snapshot: part.unit_price });
    }
    return reply(project('JobPart', await s.find('JOB_PART', filter)), 200, await bumpJob(s, job));
  };
  h.removeJobPart = async (req, s) => {
    const job = await jobFor(s, req, req.input.params.jobCardId, true); editableJob(req, job);
    const filter = { job_card_id: job.job_card_id, part_id: req.input.params.partId };
    if (!await s.find('JOB_PART', filter, { lock: true })) missing();
    await s.remove('JOB_PART', filter);
    return reply(null, 204, await bumpJob(s, job));
  };

  h.getInvoice = async (req, s) => reply(await invoiceView(s, await invoiceFor(s, req, req.input.params.invoiceId)));
  h.listInvoices = async (req, s) => {
    if (req.input.query.payment_status) {
      // Filter at SQL level before pagination; only settled records affect status.
      return listInvoicesByStatus(req, s);
    }
    const list = await scopedList(req, s, 'INVOICE', 'invoice_id', 'Invoice', { job_card_id: req.input.query.job_card_id });
    const items = [];
    for (const invoice of list.items) items.push(await invoiceView(s, invoice));
    list.items = items;
    return reply(list);
  };
  h.createInvoice = async (req, s) => {
    const job = await jobFor(s, req, req.body.job_card_id, true);
    if (job.status !== 'COMPLETED') conflict('Only completed jobs can be invoiced.');
    if (await s.find('INVOICE', { job_card_id: job.job_card_id }, { lock: true })) conflict('The job already has an invoice.');
    if (!laborRate) throw new HttpError(503, 'LABOR_RATE_NOT_CONFIGURED', 'The labor hourly rate is not configured.');
    const i = s.ident;
    const tasks = (await s.db.query(`SELECT * FROM ${i('TASK')} WHERE ${i('job_card_id')} = ${s.db.driver === 'postgres' ? '$1' : '?'} FOR UPDATE`, [job.job_card_id])).rows;
    const parts = (await s.db.query(`SELECT jp.*, p.${i('name')} FROM ${i('JOB_PART')} jp JOIN ${i('PART')} p ON p.${i('part_id')} = jp.${i('part_id')} WHERE jp.${i('job_card_id')} = ${s.db.driver === 'postgres' ? '$1' : '?'} FOR UPDATE`, [job.job_card_id])).rows;
    if (!tasks.length || tasks.some((task) => task.standard_hours === null)) conflict('Every invoice requires completed tasks with standard hours.');
    const lines = tasks.map((task) => ({ kind: 'LABOR', description: task.name, quantity: task.standard_hours, unit_price: laborRate, line_total: totalDecimal((cents(task.standard_hours) * cents(laborRate) + 50n) / 100n) }));
    for (const part of parts) {
      if (Number(part.quantity) > 99999999) invalid('A part quantity exceeds the invoice_line DECIMAL(10,2) quantity limit.');
      lines.push({ kind: 'PART', description: part.name, quantity: `${part.quantity}.00`, unit_price: part.unit_price_snapshot, line_total: totalDecimal(BigInt(part.quantity) * cents(part.unit_price_snapshot)) });
    }
    const total = totalDecimal(lines.reduce((sum, line) => sum + cents(line.line_total), 0n));
    const id = await s.insert('INVOICE', { job_card_id: job.job_card_id, total_amount: total, currency: 'KES', issued_at: new Date() }, 'invoice_id');
    for (const line of lines) await s.insert('INVOICE_LINE', { invoice_id: id, ...line });
    return reply(await invoiceView(s, await s.find('INVOICE', { invoice_id: id })), 201, { Location: `/api/v1/invoices/${id}` });
  };
  h.listInvoicePayments = async (req, s) => { await invoiceFor(s, req, req.input.params.invoiceId); return reply(project('PaymentList', await paymentList(s, req.input.params.invoiceId, req.input.query))); };
  h.getPayment = async (req, s) => {
    const payment = await s.find('PAYMENT', { payment_id: req.input.params.paymentId }) ?? missing();
    await invoiceFor(s, req, payment.invoice_id);
    return reply(project('Payment', payment));
  };
  h.recordPayment = async (req, s) => {
    const invoice = await invoiceFor(s, req, req.input.params.invoiceId, true);
    const amount = cents(req.body.amount);
    if (amount <= 0n) invalid('Payment amount must be positive.');
    const balance = cents((await invoiceView(s, invoice, true)).balance_due);
    const i = s.ident, marker = s.db.driver === 'postgres' ? '$1' : '?';
    const pending = (await s.db.query(`SELECT ${i('amount')} FROM ${i('PAYMENT_INTENT')} WHERE ${i('invoice_id')} = ${marker} AND ${i('status')} = 'PENDING' FOR UPDATE`, [invoice.invoice_id])).rows;
    // Expiry alone does not prove a provider charge failed; reserve until reconciled to a terminal status.
    const reserved = pending.reduce((sum, intent) => sum + cents(intent.amount), 0n);
    if (amount > balance - reserved) conflict('The payment exceeds the unreserved outstanding balance.');
    const reference = req.body.transaction_reference?.trim() || null;
    if (req.body.method !== 'CASH' && !reference) invalid('Non-cash payments require a verified transaction reference.');
    if (req.body.method === 'CASH' && req.body.transaction_reference) invalid('Cash payments must not include a provider transaction reference.');
    const id = await s.insert('PAYMENT', { invoice_id: invoice.invoice_id, amount: req.body.amount, method: req.body.method, transaction_reference: reference, paid_at: new Date() }, 'payment_id');
    return reply(project('Payment', await s.find('PAYMENT', { payment_id: id })), 201, { Location: `/api/v1/payments/${id}` });
  };
  // Online checkout needs a real, authenticated provider integration; never treat a client assertion as settled money.
  h.createPaymentIntent = async (req, s) => { await invoiceFor(s, req, req.input.params.invoiceId); throw new HttpError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Online checkout is not configured. Contact the garage to arrange payment.'); };
  h.getPaymentIntent = async (req, s) => {
    const intent = await s.find('PAYMENT_INTENT', { payment_intent_id: req.input.params.paymentIntentId }) ?? missing();
    await invoiceFor(s, req, intent.invoice_id);
    return reply(project('PaymentIntent', intent));
  };
  h.listAuditEvents = async (req, s) => {
    const q = req.input.query, i = s.ident, b = s.build();
    const clauses = [];
    for (const key of ['actor_user_id', 'resource_type', 'resource_id']) if (q[key] !== undefined) clauses.push(`${i(key)} = ${b.bind(q[key])}`);
    if (q.from) clauses.push(`${i('occurred_at')} >= ${b.bind(date(q.from))}`);
    if (q.to) clauses.push(`${i('occurred_at')} < ${b.bind(date(q.to))}`);
    if (q.from && q.to && date(q.to) <= date(q.from)) invalid('The audit date range must be ordered.');
    const clause = clauses.join(' AND ') || '1 = 1';
    const total = (await s.db.query(`SELECT COUNT(*) AS total FROM ${i('AUDIT_EVENT')} WHERE ${clause}`, b.values)).rows[0].total;
    const page = q.page ?? 1, page_size = q.page_size ?? 20;
    const rows = (await s.db.query(`SELECT * FROM ${i('AUDIT_EVENT')} WHERE ${clause} ORDER BY ${i('occurred_at')}, ${i('audit_id')} LIMIT ${page_size} OFFSET ${(page - 1) * page_size}`, b.values)).rows;
    return reply(project('AuditEventList', { items: rows, pagination: { page, page_size, total: Number(total) } }));
  };
  return h;
}

async function paymentList(store, invoiceId, query) {
  const i = store.ident, marker = store.db.driver === 'postgres' ? '$1' : '?';
  const total = (await store.db.query(`SELECT COUNT(*) AS total FROM ${i('PAYMENT')} WHERE ${i('invoice_id')} = ${marker}`, [invoiceId])).rows[0].total;
  const page = query.page ?? 1, page_size = query.page_size ?? 20;
  const rows = (await store.db.query(`SELECT * FROM ${i('PAYMENT')} WHERE ${i('invoice_id')} = ${marker} ORDER BY ${i('payment_id')} LIMIT ${page_size} OFFSET ${(page - 1) * page_size}`, [invoiceId])).rows;
  return { items: rows, pagination: { page, page_size, total: Number(total) } };
}

async function listInvoicesByStatus(req, store) {
  const i = store.ident, b = store.build(), q = req.input.query;
  const clauses = [];
  if (req.user.role === 'CUSTOMER') clauses.push(`v.${i('customer_id')} = ${b.bind(req.user.customer_id)}`);
  if (q.customer_id) { ownedCustomer(req, q.customer_id); if (!await store.find('CUSTOMER', { customer_id: q.customer_id })) missing(); clauses.push(`v.${i('customer_id')} = ${b.bind(q.customer_id)}`); }
  if (q.job_card_id) { await jobFor(store, req, q.job_card_id); clauses.push(`r.${i('job_card_id')} = ${b.bind(q.job_card_id)}`); }
  const paid = `COALESCE((SELECT SUM(p.${i('amount')}) FROM ${i('PAYMENT')} p WHERE p.${i('invoice_id')} = r.${i('invoice_id')}), 0)`;
  const total = `r.${i('total_amount')}`;
  clauses.push(q.payment_status === 'PAID' ? `${paid} = ${total}` : q.payment_status === 'UNPAID' ? `${paid} = 0 AND ${total} > 0` : `${paid} > 0 AND ${paid} < ${total}`);
  const base = `FROM ${i('INVOICE')} r JOIN ${i('JOB_CARD')} j ON j.${i('job_card_id')} = r.${i('job_card_id')} JOIN ${i('VEHICLE')} v ON v.${i('vehicle_id')} = j.${i('vehicle_id')} WHERE ${clauses.join(' AND ')}`;
  const count = Number((await store.db.query(`SELECT COUNT(*) AS total ${base}`, b.values)).rows[0].total);
  const page = q.page ?? 1, page_size = q.page_size ?? 20;
  const rows = (await store.db.query(`SELECT r.* ${base} ORDER BY r.${i('invoice_id')} LIMIT ${page_size} OFFSET ${(page - 1) * page_size}`, b.values)).rows;
  const items = [];
  for (const row of rows) items.push(await invoiceView(store, row));
  return reply({ items, pagination: { page, page_size, total: count } });
}
