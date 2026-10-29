import { readFileSync } from 'node:fs';

// Read the supplied DDL rather than duplicating its table/column inventory in tests.
export const officialSql = readFileSync(new URL('../../../database/schema.sql', import.meta.url), 'utf8');
export const schema = new Map([...officialSql.matchAll(/CREATE TABLE IF NOT EXISTS `?([a-z_]+)`? \(([\s\S]*?)\) ENGINE=/g)]
  .map(([, table, body]) => [table, new Set([...body.matchAll(/^\s{4}`?([a-z_]+)`?\s+(?:INT|SMALLINT|VARCHAR|CHAR|DATETIME|DECIMAL|TINYINT|ENUM|JSON)\b/gm)].map((match) => match[1]))]));

export function validateIdentifiers(sql) {
  const allColumns = new Set([...schema.values()].flatMap((columns) => [...columns]));
  for (const [, name] of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+[`"]([^`"]+)[`"]/g)) {
    if (!schema.has(name)) throw new Error(`SQL references a table outside the official schema: ${name}`);
  }
  for (const [, name] of sql.matchAll(/[`"]([^`"]+)[`"]/g)) {
    if (!schema.has(name) && !allColumns.has(name)) throw new Error(`SQL references an unknown identifier: ${name}`);
  }
}

export function logicalSql(sql) {
  validateIdentifiers(sql);
  return sql.replace(/[`"]([a-z_]+)[`"]/g, (_, name) => schema.has(name) ? name.toUpperCase() : name);
}
