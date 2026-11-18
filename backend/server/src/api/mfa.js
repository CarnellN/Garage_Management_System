// Two-factor authentication: RFC 6238 time-based one-time passwords (TOTP) and
// AES-256-GCM encryption of the shared secret before it is written to user_mfa.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 character.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Returns the 6-digit code for a given 30-second time step (RFC 4226 dynamic truncation). */
export function totpAt(secretBase32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Checks a code against the previous, current and next time step to allow for clock drift.
 * Returns the matched step so callers can reject a replay of the same code, or null.
 */
export function verifyTotp(secretBase32, code, { now = Date.now(), lastUsedStep = null } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastUsedStep !== null && candidate <= Number(lastUsedStep)) continue;
    const expected = Buffer.from(totpAt(secretBase32, candidate));
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return null;
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/**
 * Field encryption for secrets stored in the database. The key comes from DATA_ENCRYPTION_KEY,
 * or is derived from JWT_SECRET with HKDF using a separate label so the two uses never share a key.
 * Stored format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.
 */
export function createCipher({ dataKey, jwtSecret }) {
  let key = null;
  if (dataKey) key = Buffer.from(dataKey, 'base64url');
  else if (jwtSecret) key = Buffer.from(hkdfSync('sha256', jwtSecret, 'garage-management', 'field-encryption-v1', 32));
  const ready = () => {
    if (!key || key.length !== 32) throw Object.assign(new Error('Field encryption is not configured.'), { status: 503, code: 'ENCRYPTION_NOT_CONFIGURED' });
  };
  return {
    encrypt(plain) {
      ready();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    },
    decrypt(stored) {
      ready();
      const [version, iv, tag, body] = String(stored).split('.');
      if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unsupported encrypted value.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}
