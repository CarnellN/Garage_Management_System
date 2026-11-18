// Creates (or re-activates) an ADMIN account. The schema leaves first-admin provisioning to deployment,
// so run this once after installing the database:
//   npm run admin:create
//   ADMIN_NAME="Sarah Njeri" ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='long passphrase' npm run admin:create
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/api/security.js';
import { adminConnection, prompter, validEmail } from './lib/tools.js';

export async function createAdmin(databaseConfig, { name, email, password }) {
  if (!name?.trim()) throw new Error('Name is required.');
  if (!validEmail(email ?? '')) throw new Error('A valid email is required.');
  if ((password ?? '').length < 12) throw new Error('Password must have at least 12 characters.');
  const connection = await adminConnection(databaseConfig);
  try {
    const normalized = email.trim().toLowerCase();
    const [existing] = await connection.execute('SELECT user_id, role FROM `user` WHERE email = ?', [normalized]);
    if (existing.length && existing[0].role === 'CUSTOMER') throw new Error('That email belongs to a customer account; use a staff email.');
    const hash = await hashPassword(password);
    if (existing.length) {
      await connection.execute('UPDATE `user` SET name = ?, password_hash = ?, role = ?, active = 1, customer_id = NULL WHERE user_id = ?', [name.trim(), hash, 'ADMIN', existing[0].user_id]);
      return { userId: existing[0].user_id, created: false };
    }
    const [result] = await connection.execute('INSERT INTO `user` (customer_id, name, email, password_hash, role, active) VALUES (NULL, ?, ?, ?, ?, 1)', [name.trim(), normalized, hash, 'ADMIN']);
    return { userId: result.insertId, created: true };
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const io = prompter();
  try {
    const config = loadConfig();
    const name = process.env.ADMIN_NAME || await io.ask('Admin full name');
    const email = process.env.ADMIN_EMAIL || await io.ask('Admin email');
    const password = process.env.ADMIN_PASSWORD || await io.secret('Admin password (12+ characters)');
    const { userId, created } = await createAdmin(config.database, { name, email, password });
    console.info(`${created ? 'Created' : 'Updated'} admin account #${userId} (${email.trim().toLowerCase()}).`);
  } catch (error) {
    console.error(`Could not create the admin account: ${error.code ? `${error.code}. Check the database settings in .env.local.` : error.message}`);
    process.exitCode = 1;
  } finally {
    io.close();
  }
}
