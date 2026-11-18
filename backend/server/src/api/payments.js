// Online checkout through M-Pesa STK push.
// Flow: createPaymentIntent reserves the amount (PENDING intent) in one transaction, then after commit
// asks Daraja to prompt the customer's phone. Money is only settled when Daraja confirms the result
// server-to-server (callback verified by an STK status query, or a manual refresh).
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors.js';
import { project } from './contract.js';
import { createStore } from './sql.js';
import { reply, invalid, conflict, missing } from './resources.js';
import { invoiceFor, invoiceView, cents } from './workflows.js';
import { normalizeMsisdn } from '../services/mpesa.js';

const INTENT_LIFETIME_MS = 5 * 60 * 1000;
const notConfigured = () => { throw new HttpError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Online checkout is not configured. Contact the garage to arrange payment.'); };

async function auditSystem(store, action, resourceId, requestId, outcome = 'SUCCESS') {
  await store.insert('AUDIT_EVENT', { actor_user_id: null, action, resource_type: 'Payments', resource_id: resourceId, occurred_at: new Date(), request_id: requestId, outcome });
}

/**
 * Applies a verified provider outcome exactly once. Locks invoice then intent (the same order as
 * recordPayment) so a concurrent staff payment cannot overpay against the reservation.
 */
export async function settleIntent(database, intentId, { state, receipt, requestId }) {
  return database.transaction(async (tx) => {
    const store = createStore(tx);
    const peek = await store.find('PAYMENT_INTENT', { payment_intent_id: intentId });
    if (!peek) return null;
    await store.find('INVOICE', { invoice_id: peek.invoice_id }, { lock: true });
    const intent = await store.find('PAYMENT_INTENT', { payment_intent_id: intentId }, { lock: true });
    if (intent.status !== 'PENDING' || state === 'PENDING') return intent;
    if (state === 'SUCCEEDED') {
      const reference = receipt || `MPESA-${intent.provider_id}`;
      const paymentId = await store.insert('PAYMENT', { invoice_id: intent.invoice_id, amount: intent.amount, method: 'MOBILE_MONEY', transaction_reference: reference, paid_at: new Date() }, 'payment_id');
      await store.update('PAYMENT_INTENT', { payment_intent_id: intentId }, { status: 'SUCCEEDED', payment_id: paymentId });
      await auditSystem(store, 'settlePaymentIntent', intentId, requestId);
    } else {
      await store.update('PAYMENT_INTENT', { payment_intent_id: intentId }, { status: 'FAILED' });
      await auditSystem(store, 'failPaymentIntent', intentId, requestId);
    }
    return store.find('PAYMENT_INTENT', { payment_intent_id: intentId });
  });
}

export function paymentHandlers({ database, mpesa, logger = console }) {
  return {
    async createPaymentIntent(req, s) {
      const invoice = await invoiceFor(s, req, req.input.params.invoiceId, true);
      if (!mpesa?.configured) notConfigured();
      if (req.body.method !== 'MOBILE_MONEY') invalid('Online checkout currently supports M-Pesa only. Use method MOBILE_MONEY.');
      const amount = cents(req.body.amount);
      if (amount <= 0n) invalid('Payment amount must be positive.');
      if (amount % 100n !== 0n) invalid('M-Pesa payments must be whole Kenyan shillings (for example 2500.00).');
      const balance = cents((await invoiceView(s, invoice, true)).balance_due);
      const i = s.ident;
      const pending = (await s.db.query(`SELECT ${i('amount')} FROM ${i('PAYMENT_INTENT')} WHERE ${i('invoice_id')} = ? AND ${i('status')} = 'PENDING' FOR UPDATE`, [invoice.invoice_id])).rows;
      const reserved = pending.reduce((sum, row) => sum + cents(row.amount), 0n);
      if (amount > balance - reserved) conflict('The payment exceeds the unreserved outstanding balance.');
      let phone = req.body.phone;
      if (!phone) {
        const job = await s.find('JOB_CARD', { job_card_id: invoice.job_card_id });
        const vehicle = await s.find('VEHICLE', { vehicle_id: job.vehicle_id });
        phone = (await s.find('CUSTOMER', { customer_id: vehicle.customer_id }))?.phone;
      }
      const msisdn = normalizeMsisdn(phone);
      if (!msisdn) invalid('Provide a Safaricom number such as 0712345678 or +254712345678.');
      const id = randomUUID();
      await s.insert('PAYMENT_INTENT', { payment_intent_id: id, invoice_id: invoice.invoice_id, amount: req.body.amount, method: 'MOBILE_MONEY', status: 'PENDING', checkout_url: null, expires_at: new Date(Date.now() + INTENT_LIFETIME_MS), payment_id: null, provider_id: null });
      const created = project('PaymentIntent', await s.find('PAYMENT_INTENT', { payment_intent_id: id }));
      const result = reply(created, 201, { Location: `/api/v1/payment-intents/${id}` });
      // The reservation is committed before the phone prompt, so no network call holds database locks.
      result.afterCommit = async () => {
        try {
          const { checkoutRequestId } = await mpesa.stkPush({ amount: Number(amount / 100n), phone: msisdn, reference: `INV${invoice.invoice_id}`, description: `Invoice ${invoice.invoice_id}` });
          await database.query('UPDATE `payment_intent` SET `provider_id` = ? WHERE `payment_intent_id` = ?', [checkoutRequestId, id]);
        } catch (error) {
          logger.error({ event: 'mpesa_stk_push_failed', request_id: req.requestId, provider_status: error.providerStatus ?? null });
          await settleIntent(database, id, { state: 'FAILED', requestId: req.requestId });
          throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'M-Pesa could not send the payment prompt. Check the phone number and try again.');
        }
      };
      return result;
    },

    async refreshPaymentIntent(req, s) {
      const intent = await s.find('PAYMENT_INTENT', { payment_intent_id: req.input.params.paymentIntentId }) ?? missing();
      await invoiceFor(s, req, intent.invoice_id);
      const result = reply(project('PaymentIntent', intent));
      if (intent.status !== 'PENDING' || !intent.provider_id) return result;
      if (!mpesa?.configured) notConfigured();
      result.afterCommit = async () => {
        const answer = await mpesa.query(intent.provider_id);
        const updated = await settleIntent(database, intent.payment_intent_id, { state: answer.state, requestId: req.requestId });
        return { body: project('PaymentIntent', updated) };
      };
      return result;
    },
  };
}

/** Express handler for Daraja's STK callback. Always acknowledges so Safaricom does not retry forever. */
export function mpesaCallback({ database, mpesa, callbackToken, logger = console }) {
  const expected = Buffer.from(callbackToken ?? '');
  return async (req, res) => {
    const supplied = Buffer.from(req.params.token ?? '');
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'The requested endpoint does not exist.', request_id: req.requestId });
    }
    const ack = () => res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    try {
      const callback = req.body?.Body?.stkCallback;
      if (!callback?.CheckoutRequestID) return ack();
      const store = createStore(database);
      const intent = await store.find('PAYMENT_INTENT', { provider_id: String(callback.CheckoutRequestID) });
      if (!intent || intent.status !== 'PENDING') return ack();
      // The callback body is unauthenticated: confirm the outcome with Daraja before settling money.
      const answer = await mpesa.query(intent.provider_id);
      const items = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map((item) => [item.Name, item.Value]));
      const receipt = /^[A-Z0-9]{8,20}$/.test(String(items.MpesaReceiptNumber ?? '')) ? String(items.MpesaReceiptNumber) : null;
      if (answer.state === 'SUCCEEDED' && items.Amount !== undefined && cents(`${Number(items.Amount).toFixed(2)}`) !== cents(intent.amount)) {
        logger.error({ event: 'mpesa_amount_mismatch', request_id: req.requestId });
        return ack();
      }
      await settleIntent(database, intent.payment_intent_id, { state: answer.state, receipt, requestId: req.requestId });
    } catch {
      logger.error({ event: 'mpesa_callback_failed', request_id: req.requestId });
    }
    return ack();
  };
}
