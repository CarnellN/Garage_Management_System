import { writeFileSync } from 'node:fs';
import { contract, operations } from '../src/api/contract.js';

const metadata = Object.fromEntries(operations.map((operation) => {
  const headers = (operation.parameters ?? []).map((parameter) => parameter.$ref
    ? parameter.$ref.split('/').slice(1).reduce((node, key) => node[key], contract) : parameter)
    .filter((parameter) => parameter.in === 'header' && parameter.required).map((parameter) => parameter.name);
  return [operation.operationId, { method: operation.method.toUpperCase(), path: operation.path, headers }];
}));
writeFileSync(new URL('../../../docs/api-operations.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
console.info(`Generated ${operations.length} frontend operation definitions.`);
