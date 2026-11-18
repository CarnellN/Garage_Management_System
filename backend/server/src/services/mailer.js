// Outgoing email (password reset links). Uses SMTP when configured. Without SMTP,
// development/test servers write the message to the log so the flow can be demonstrated;
// production servers refuse to pretend a message was delivered.
import nodemailer from 'nodemailer';

export function createMailer(config = {}, logger = console) {
  const transport = config.host
    ? nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    })
    : null;
  return {
    configured: Boolean(transport),
    async send({ to, subject, text }) {
      if (transport) {
        await transport.sendMail({ from: config.from, to, subject, text });
        return;
      }
      if (config.nodeEnv === 'production') {
        logger.error({ event: 'mail_not_configured', subject });
        return;
      }
      // Development outbox: the message (including any reset link) is visible to the developer only.
      logger.info({ event: 'dev_mail_outbox', to, subject, text });
    },
  };
}
