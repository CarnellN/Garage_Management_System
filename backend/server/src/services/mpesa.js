// Safaricom Daraja (M-Pesa) adapter: Lipa Na M-Pesa Online "STK push" checkout and status query.
// Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
// The adapter performs network calls only; settlement decisions live in api/payments.js.

const HOSTS = { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' };
// STK query result codes that are final failures (customer cancelled, timed out, insufficient funds, etc.).
export const FINAL_FAILURE_CODES = new Set(['1', '1001', '1019', '1025', '1032', '1037', '2001', '9999']);

/** Daraja expects a Nairobi local timestamp formatted YYYYMMDDHHmmss. */
export function darajaTimestamp(now = new Date()) {
  return new Date(+now + 3 * 3600000).toISOString().replace(/\D/g, '').slice(0, 14);
}

/** Normalizes Kenyan mobile numbers (07.., 01.., +2547.., 2547..) to the 2547XXXXXXXX form Daraja requires. */
export function normalizeMsisdn(phone) {
  const digits = String(phone ?? '').replace(/[\s-]/g, '').replace(/^\+/, '');
  const local = digits.match(/^0([17]\d{8})$/);
  if (local) return `254${local[1]}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}

export function createMpesa(config = {}, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const configured = Boolean(config.consumerKey && config.consumerSecret && config.shortcode && config.passkey && config.callbackUrl);
  const base = HOSTS[config.environment ?? 'sandbox'];
  let cachedToken = null;

  async function request(path, { method = 'POST', headers = {}, body } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }
  async function token() {
    if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const result = await request('/oauth/v1/generate?grant_type=client_credentials', { method: 'GET', headers: { Authorization: `Basic ${basic}` } });
    if (!result.ok || !result.data.access_token) throw Object.assign(new Error('M-Pesa authentication failed.'), { providerStatus: result.status });
    // Refresh one minute early to avoid using a token at the moment it expires.
    cachedToken = { value: result.data.access_token, expires: Date.now() + (Number(result.data.expires_in ?? 3599) - 60) * 1000 };
    return cachedToken.value;
  }
  const password = (timestamp) => Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');

  return {
    configured,
    environment: config.environment ?? 'sandbox',
    /** Sends the payment prompt to the customer's phone. Returns Daraja's CheckoutRequestID. */
    async stkPush({ amount, phone, reference, description }) {
      const timestamp = darajaTimestamp();
      const result = await request('/mpesa/stkpush/v1/processrequest', {
        headers: { Authorization: `Bearer ${await token()}` },
        body: {
          BusinessShortCode: config.shortcode, Password: password(timestamp), Timestamp: timestamp,
          TransactionType: config.transactionType ?? 'CustomerPayBillOnline', Amount: amount,
          PartyA: phone, PartyB: config.shortcode, PhoneNumber: phone,
          CallBackURL: config.callbackUrl, AccountReference: reference.slice(0, 12), TransactionDesc: description.slice(0, 13),
        },
      });
      if (!result.ok || String(result.data.ResponseCode) !== '0' || !result.data.CheckoutRequestID) {
        throw Object.assign(new Error('M-Pesa rejected the payment request.'), { providerStatus: result.status, providerMessage: result.data.errorMessage ?? result.data.ResponseDescription });
      }
      return { checkoutRequestId: result.data.CheckoutRequestID, customerMessage: result.data.CustomerMessage };
    },
    /**
     * Asks Daraja for the authoritative result of a checkout.
     * Returns { state: 'SUCCEEDED' | 'FAILED' | 'PENDING', resultCode, description }.
     */
    async query(checkoutRequestId) {
      const timestamp = darajaTimestamp();
      const result = await request('/mpesa/stkpushquery/v1/query', {
        headers: { Authorization: `Bearer ${await token()}` },
        body: { BusinessShortCode: config.shortcode, Password: password(timestamp), Timestamp: timestamp, CheckoutRequestID: checkoutRequestId },
      });
      const code = result.data.ResultCode === undefined ? null : String(result.data.ResultCode);
      if (code === '0') return { state: 'SUCCEEDED', resultCode: code, description: result.data.ResultDesc };
      if (code && FINAL_FAILURE_CODES.has(code)) return { state: 'FAILED', resultCode: code, description: result.data.ResultDesc };
      // Still processing, throttled or an unknown answer: keep the reservation until a final answer arrives.
      return { state: 'PENDING', resultCode: code, description: result.data.ResultDesc ?? result.data.errorMessage };
    },
  };
}
