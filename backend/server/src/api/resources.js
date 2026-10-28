import { HttpError } from '../errors.js';
import { project } from './contract.js';
import { hashPassword, publicUser } from './security.js';

export const missing = () => { throw new HttpError(404, 'NOT_FOUND', 'The resource does not exist.'); };
export const conflict = (message) => { throw new HttpError(409, 'CONFLICT', message); };
export const invalid = (message) => { throw new HttpError(422, 'VALIDATION_ERROR', message); };
export const reply = (body, status = 200, headers = {}) => ({ body, status, headers });
export function ownedCustomer(req, customerId) {
  if (req.user.role === 'CUSTOMER' && Number(req.user.customer_id) !== Number(customerId)) missing();
}
export async function vehicleFor(store, req, id, lock = false) {
  const row = await store.find('VEHICLE', { vehicle_id: id }, { lock });
  if (!row) missing();
  ownedCustomer(req, row.customer_id);
  return row;
}
export async function jobFor(store, req, id, lock = false) {
  const row = await store.find('JOB_CARD', { job_card_id: id }, { lock });
  if (!row) missing();
  if (req.user.role === 'MECHANIC' && Number(row.mechanic_id) !== req.user.user_id) missing();
  if (req.user.role === 'CUSTOMER') await vehicleFor(store, req, row.vehicle_id);
  return row;
}
export function assertVersion(req, row) {
  const tag = req.input.headers['If-Match'];
  if (tag !== `"${row.version}"`) throw new HttpError(412, 'PRECONDITION_FAILED', 'The resource has changed. Fetch its latest ETag.');
}
export function editableJob(req, row) {
  assertVersion(req, row);
  if (!['OPEN', 'IN_PROGRESS', 'AWAITING_PARTS'].includes(row.status)) conflict('This job can no longer be edited.');
}
export async function bumpJob(store, job) {
  job.version = Number(job.version) + 1;
  await store.update('JOB_CARD', { job_card_id: job.job_card_id }, { version: job.version });
  return { ETag: `"${job.version}"` };
}
function normalizedCustomer(body) {
  return { ...body, ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...(body.email ? { email: body.email.trim().toLowerCase() } : {}) };
}

export function resourceHandlers() {
  const handlers = {};
  handlers.listCustomers = async (req, s) => reply(project('CustomerList', await s.list('CUSTOMER', {}, { ...req.input.query, searchFields: ['name', 'email', 'phone'] })));
  handlers.createCustomer = async (req, s) => {
    const id = await s.insert('CUSTOMER', { phone: null, email: null, ...normalizedCustomer(req.body) }, 'customer_id');
    return reply(project('Customer', await s.find('CUSTOMER', { customer_id: id })), 201, { Location: `/api/v1/customers/${id}` });
  };
  handlers.getCustomer = async (req, s) => {
    ownedCustomer(req, req.input.params.customerId);
    const row = await s.find('CUSTOMER', { customer_id: req.input.params.customerId });
    return reply(project('Customer', row ?? missing()));
  };
  handlers.updateCustomer = async (req, s) => {
    ownedCustomer(req, req.input.params.customerId);
    const filter = { customer_id: req.input.params.customerId };
    if (!await s.find('CUSTOMER', filter, { lock: true })) missing();
    await s.update('CUSTOMER', filter, normalizedCustomer(req.body));
    return reply(project('Customer', await s.find('CUSTOMER', filter)));
  };
  handlers.listVehicles = async (req, s) => {
    const { customer_id, registration_no } = req.input.query;
    if (customer_id) {
      ownedCustomer(req, customer_id);
      if (!await s.find('CUSTOMER', { customer_id })) missing();
    }
    const filters = req.user.role === 'CUSTOMER' ? { customer_id: req.user.customer_id } : {};
    if (customer_id) filters.customer_id = customer_id;
    if (registration_no) filters.registration_no = registration_no.trim().toUpperCase();
    return reply(project('VehicleList', await s.list('VEHICLE', filters, req.input.query)));
  };
  handlers.createVehicle = async (req, s) => {
    if (!req.body.registration_no.trim()) invalid('registration_no must not be blank.');
    ownedCustomer(req, req.body.customer_id);
    if (!await s.find('CUSTOMER', { customer_id: req.body.customer_id }, { lock: true })) missing();
    const id = await s.insert('VEHICLE', { make: null, model: null, ...req.body, registration_no: req.body.registration_no.trim().toUpperCase() }, 'vehicle_id');
    return reply(project('Vehicle', await s.find('VEHICLE', { vehicle_id: id })), 201, { Location: `/api/v1/vehicles/${id}` });
  };
  handlers.getVehicle = async (req, s) => reply(project('Vehicle', await vehicleFor(s, req, req.input.params.vehicleId)));
  handlers.updateVehicle = async (req, s) => {
    const row = await vehicleFor(s, req, req.input.params.vehicleId, true);
    const data = { ...req.body };
    if (data.registration_no !== undefined) {
      data.registration_no = data.registration_no.trim().toUpperCase();
      if (!data.registration_no) invalid('registration_no must not be blank.');
    }
    await s.update('VEHICLE', { vehicle_id: row.vehicle_id }, data);
    return reply(project('Vehicle', await s.find('VEHICLE', { vehicle_id: row.vehicle_id })));
  };
  handlers.deleteVehicle = async (req, s) => {
    const row = await vehicleFor(s, req, req.input.params.vehicleId, true);
    if (await s.find('BOOKING', { vehicle_id: row.vehicle_id }) || await s.find('JOB_CARD', { vehicle_id: row.vehicle_id })) conflict('Vehicles with service history cannot be deleted.');
    await s.remove('VEHICLE', { vehicle_id: row.vehicle_id });
    return reply(null, 204);
  };

  for (const [name, table, idKey, param, defaults] of [
    ['Part', 'PART', 'part_id', 'partId', { unit_price: null }],
    ['ServiceTask', 'SERVICE_TASK', 'service_task_id', 'serviceTaskId', { standard_hours: null }],
  ]) {
    handlers[`list${name}s`] = async (req, s) => reply(project(`${name}List`, await s.list(table, {}, { ...req.input.query, searchFields: ['name'] })));
    handlers[`get${name}`] = async (req, s) => reply(project(name, await s.find(table, { [idKey]: req.input.params[param] }) ?? missing()));
    handlers[`create${name}`] = async (req, s) => {
      const id = await s.insert(table, { ...defaults, ...req.body, name: req.body.name.trim() }, idKey);
      return reply(project(name, await s.find(table, { [idKey]: id })), 201, { Location: `/api/v1/${name === 'Part' ? 'parts' : 'service-tasks'}/${id}` });
    };
    handlers[`update${name}`] = async (req, s) => {
      const filters = { [idKey]: req.input.params[param] };
      if (!await s.find(table, filters, { lock: true })) missing();
      await s.update(table, filters, { ...req.body, ...(req.body.name !== undefined ? { name: req.body.name.trim() } : {}) });
      return reply(project(name, await s.find(table, filters)));
    };
    handlers[`delete${name}`] = async (req, s) => {
      const filters = { [idKey]: req.input.params[param] };
      if (!await s.find(table, filters, { lock: true })) missing();
      if (name === 'Part' && await s.find('JOB_PARTS', { part_id: filters.part_id })) conflict('Referenced parts cannot be deleted.');
      await s.remove(table, filters);
      return reply(null, 204);
    };
  }
  handlers.listStaffUsers = async (req, s) => reply(project('UserList', await s.list('USER', { role: req.input.query.role ?? ['RECEPTIONIST', 'MECHANIC', 'ADMIN'] }, req.input.query)));
  handlers.getStaffUser = async (req, s) => {
    const user = await s.find('USER', { user_id: req.input.params.userId });
    if (!user || user.role === 'CUSTOMER') missing();
    return reply(publicUser(user));
  };
  handlers.createStaffUser = async (req, s) => {
    const { password, ...body } = req.body;
    const id = await s.insert('USER', { ...body, name: body.name.trim(), email: body.email.trim().toLowerCase(), password_hash: await hashPassword(password), customer_id: null, active: true }, 'user_id');
    return reply(publicUser(await s.find('USER', { user_id: id })), 201, { Location: `/api/v1/users/${id}` });
  };
  handlers.updateStaffUser = async (req, s) => {
    const filter = { user_id: req.input.params.userId };
    // Lock the admin set in primary-key order before changing last-admin membership.
    const admins = await s.db.query(`SELECT ${s.ident('user_id')} FROM ${s.ident('USER')} WHERE ${s.ident('role')} = 'ADMIN' AND ${s.ident('active')} = TRUE ORDER BY ${s.ident('user_id')} FOR UPDATE`);
    const user = await s.find('USER', filter, { lock: true });
    if (!user || user.role === 'CUSTOMER') missing();
    if (user.role === 'ADMIN' && user.active && admins.rows.length <= 1 && (req.body.active === false || (req.body.role && req.body.role !== 'ADMIN'))) conflict('The last active admin cannot be demoted or disabled.');
    if (user.role === 'MECHANIC' && (req.body.active === false || (req.body.role && req.body.role !== 'MECHANIC'))) {
      if (await s.find('JOB_CARD', { mechanic_id: user.user_id, status: ['OPEN', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETED'] })) conflict('Reassign active mechanic jobs first.');
    }
    await s.update('USER', filter, req.body);
    if (req.body.role !== undefined || req.body.active !== undefined) await s.update('AUTH_SESSION', { user_id: user.user_id, revoked_at: null }, { revoked_at: new Date() });
    return reply(publicUser(await s.find('USER', filter)));
  };
  return handlers;
}
