import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { HttpError } from '../errors.js';

export const contract = YAML.parse(readFileSync(new URL('../../../../docs/openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
ajv.addFormat('int32', { type: 'number', validate: (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 });
ajv.addSchema({ $id: 'garage', components: contract.components });
const resolve = (value) => value?.$ref ? value.$ref.split('/').slice(1).reduce((node, key) => node[key], contract) : value;
export const operations = Object.entries(contract.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({ path, method, ...operation })));

function invalid(details, status = 422) {
  const error = new HttpError(status, 'VALIDATION_ERROR', 'Check the supplied fields.');
  error.details = details;
  throw error;
}
const validators = new Map();
function validator(schema) {
  const cacheKey = JSON.stringify(schema);
  if (!validators.has(cacheKey)) {
    validators.set(cacheKey, ajv.compile({ ...schema, components: contract.components }));
  }
  return validators.get(cacheKey);
}
export function validateRequest(operation) {
  const bodySchema = operation.requestBody?.content['application/json'].schema;
  const bodyValidator = bodySchema ? validator(bodySchema) : null;
  const parameters = (operation.parameters ?? []).map(resolve);
  const parameterValidators = parameters.map((parameter) => validator(parameter.schema));
  return (req, res, next) => {
    try {
      if (bodyValidator) {
        if (!req.is('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
        if (!bodyValidator(req.body)) invalid(bodyValidator.errors.map((e) => ({ field: e.instancePath.slice(1) || e.params.missingProperty || e.params.additionalProperty || 'body', message: e.message })));
      }
      const input = { params: {}, query: {}, headers: {} };
      for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        const source = parameter.in === 'path' ? req.params : parameter.in === 'header' ? req.headers : req.query;
        let value = source[parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name];
        if (value === undefined && parameter.schema.default !== undefined) value = parameter.schema.default;
        if (value === undefined) {
          if (!parameter.required) continue;
          if (parameter.name === 'If-Match') throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Supply the latest ETag in If-Match.');
          invalid([{ field: parameter.name, message: 'is required' }], 400);
        }
        if (parameter.schema.type === 'integer') {
          if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
          if (!Number.isSafeInteger(value) || value > 2147483647) invalid([{ field: parameter.name, message: 'must be a valid INT' }]);
        }
        if (!parameterValidators[index](value)) invalid([{ field: parameter.name, message: 'has an invalid value' }]);
        input[parameter.in === 'path' ? 'params' : parameter.in === 'header' ? 'headers' : 'query'][parameter.name] = value;
      }
      const allowed = new Set(parameters.filter((p) => p.in === 'query').map((p) => p.name));
      for (const key of Object.keys(req.query)) if (!allowed.has(key)) invalid([{ field: key, message: 'is not supported' }]);
      req.input = input;
      next();
    } catch (error) { next(error); }
  };
}

// Projection keeps database-only fields (especially password_hash) out of responses.
export function project(schemaName, value) {
  const convert = (schema, data) => {
    schema = resolve(schema);
    if (data === null || data === undefined) return data ?? null;
    if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).filter(([key]) => data[key] !== undefined).map(([key, property]) => [key, convert(property, data[key])]));
    if (schema.type === 'array') return data.map((entry) => convert(schema.items, entry));
    if (schema.type === 'boolean') return data === true || data === 1;
    if (schema.type === 'integer') return Number(data);
    if (schema.format === 'date-time') {
      const date = data instanceof Date ? data : new Date(/[zZ]|[+-]\d\d:\d\d$/.test(data) ? data : `${data.replace(' ', 'T')}Z`);
      return date.toISOString();
    }
    return data;
  };
  return convert(contract.components.schemas[schemaName], value);
}
