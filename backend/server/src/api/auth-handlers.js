import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../errors.js';
import { hashPassword, verifyPassword, publicUser } from './security.js';
import { reply, invalid, conflict, missing } from './resources.js';
import { revokeSession, revokeUserSessions, utcDate } from './sessions.js';
import { newTotpSecret, otpauthUri, verifyTotp } from './mfa.js';

const RESET_LIFETIME_MS = 30 * 60 * 1000;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function authHandlers(database, security, { cipher, mailer, appBaseUrl = 'http://localhost:5173', issuer = 'Garage Management System', logger = console } = {}) {
  /** Verifies a TOTP code for an enrolled user and records the step so the same code cannot be replayed. */
  async function checkSecondFactor(store, userId, code) {
    const mfa = await store.find('USER_MFA', { user_id: userId }, { lock: true });
    if (!mfa?.enabled) return true;
    if (!code) throw new HttpError(401, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app.');
    const step = verifyTotp(cipher.decrypt(mfa.secret_encrypted), code, { lastUsedStep: mfa.last_used_step });
    if (step === null) throw new HttpError(401, 'INVALID_OTP', 'The authentication code is incorrect or has already been used.');
    await store.update('USER_MFA', { user_id: userId }, { last_used_step: step });
    return true;
  }

  return {
    async registerCustomer(req, store) {
      security.configured();
      const name = req.body.name.trim();
      const email = req.body.email.trim().toLowerCase();
      if (!name) invalid('Name must not be blank.');
      const password_hash = await hashPassword(req.body.password);
      const customer_id = await store.insert('CUSTOMER', { name, email, phone: req.body.phone ?? null }, 'customer_id');
      const user_id = await store.insert('USER', { name, email, password_hash, customer_id, role: 'CUSTOMER', active: true }, 'user_id');
      const user = await store.find('USER', { user_id });
      req.auditActorId = user_id;
      return reply(await security.session(store, user), 201, { Location: '/api/v1/auth/me' });
    },
    async login(req, store) {
      security.configured();
      const email = req.body.email.trim().toLowerCase();
      const user = await store.find('USER', { email });
      const matches = await verifyPassword(req.body.password, user?.password_hash);
      if (!matches || !user?.active) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      const locked = await store.find('USER', { user_id: user.user_id }, { lock: true });
      if (!locked?.active || locked.password_hash !== user.password_hash) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      req.auditActorId = user.user_id;
      await checkSecondFactor(store, user.user_id, req.body.otp);
      return reply(await security.session(store, locked));
    },
    async getCurrentUser(req) { return reply(publicUser(req.user)); },
    async logout(req, store) {
      await revokeSession(store, req.user.user_id, req.sessionId);
      return reply(null, 204);
    },

    // ---- Password recovery and change --------------------------------------------------------
    async requestPasswordReset(req, store) {
      const email = req.body.email.trim().toLowerCase();
      const user = await store.find('USER', { email });
      // Same response whether or not the account exists, so the endpoint cannot be used to discover emails.
      const result = reply({ message: 'If an active account uses that email, a reset link has been sent.' }, 202);
      if (!user?.active) return result;
      req.auditActorId = user.user_id;
      const token = randomBytes(32).toString('base64url');
      await store.update('PASSWORD_RESET', { user_id: user.user_id, used_at: null }, { used_at: new Date() });
      await store.insert('PASSWORD_RESET', { user_id: user.user_id, token_hash: sha256(token), expires_at: new Date(Date.now() + RESET_LIFETIME_MS), used_at: null, created_at: new Date() }, 'password_reset_id');
      result.afterCommit = async () => {
        try {
          await mailer.send({
            to: user.email,
            subject: 'Reset your Garage Management System password',
            text: `Hello ${user.name},\n\nUse this link within 30 minutes to choose a new password:\n${appBaseUrl.replace(/\/$/, '')}/reset-password?token=${token}\n\nReset token (if your app asks for it): ${token}\n\nIf you did not ask for this, ignore this email; your password is unchanged.`,
          });
        } catch {
          logger.error({ event: 'password_reset_mail_failed', request_id: req.requestId });
        }
      };
      return result;
    },
    async resetPassword(req, store) {
      security.configured();
      const row = await store.find('PASSWORD_RESET', { token_hash: sha256(req.body.token), used_at: null }, { lock: true });
      if (!row || utcDate(row.expires_at).getTime() <= Date.now()) throw new HttpError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Request a new one.');
      const user = await store.find('USER', { user_id: row.user_id }, { lock: true });
      if (!user?.active) throw new HttpError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Request a new one.');
      req.auditActorId = user.user_id;
      await store.update('USER', { user_id: user.user_id }, { password_hash: await hashPassword(req.body.password) });
      await store.update('PASSWORD_RESET', { password_reset_id: row.password_reset_id }, { used_at: new Date() });
      await revokeUserSessions(store, user.user_id);
      return reply(null, 204);
    },
    async changePassword(req, store) {
      const user = await store.find('USER', { user_id: req.user.user_id }, { lock: true });
      if (!await verifyPassword(req.body.current_password, user.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'The current password is incorrect.');
      if (req.body.current_password === req.body.new_password) invalid('Choose a password different from the current one.');
      await store.update('USER', { user_id: user.user_id }, { password_hash: await hashPassword(req.body.new_password) });
      // Every existing session, including this one, ends because the account fingerprint changed.
      await revokeUserSessions(store, user.user_id);
      return reply(null, 204);
    },

    // ---- Two-factor authentication (TOTP) -----------------------------------------------------
    async setupMfa(req, store) {
      const existing = await store.find('USER_MFA', { user_id: req.user.user_id }, { lock: true });
      if (existing?.enabled) conflict('Two-factor authentication is already enabled. Disable it first to enrol a new device.');
      const secret = newTotpSecret();
      const secret_encrypted = cipher.encrypt(secret);
      if (existing) await store.update('USER_MFA', { user_id: req.user.user_id }, { secret_encrypted, enabled: false, last_used_step: null });
      else await store.insert('USER_MFA', { user_id: req.user.user_id, secret_encrypted, enabled: false, last_used_step: null });
      return reply({ secret, otpauth_uri: otpauthUri({ secret, account: req.user.email, issuer }) }, 201);
    },
    async enableMfa(req, store) {
      const mfa = await store.find('USER_MFA', { user_id: req.user.user_id }, { lock: true });
      if (!mfa) conflict('Start two-factor setup first.');
      if (mfa.enabled) conflict('Two-factor authentication is already enabled.');
      const step = verifyTotp(cipher.decrypt(mfa.secret_encrypted), req.body.code);
      if (step === null) invalid('The authentication code is incorrect. Check the time on your phone and try again.');
      await store.update('USER_MFA', { user_id: req.user.user_id }, { enabled: true, last_used_step: step });
      return reply({ enabled: true });
    },
    async disableMfa(req, store) {
      const user = await store.find('USER', { user_id: req.user.user_id }, { lock: true });
      if (!await verifyPassword(req.body.password, user.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'The password is incorrect.');
      const mfa = await store.find('USER_MFA', { user_id: user.user_id }, { lock: true });
      if (!mfa?.enabled) conflict('Two-factor authentication is not enabled.');
      await checkSecondFactor(store, user.user_id, req.body.code);
      await store.remove('USER_MFA', { user_id: user.user_id });
      return reply({ enabled: false });
    },
    async resetUserMfa(req, store) {
      const user = await store.find('USER', { user_id: req.input.params.userId }, { lock: true });
      if (!user) missing();
      await store.remove('USER_MFA', { user_id: user.user_id });
      await revokeUserSessions(store, user.user_id);
      return reply({ enabled: false });
    },
    async getMfaStatus(req, s) {
      const mfa = await s.find('USER_MFA', { user_id: req.user.user_id });
      return reply({ enabled: Boolean(mfa?.enabled === true || mfa?.enabled === 1) });
    },
  };
}
