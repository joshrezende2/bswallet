import { readFileSync } from 'node:fs';

// Delimiters are part of the checked-in endpoint bundle. Keep this deliberately
// small: the contract is direct record accesses, not a XanoScript interpreter.
const source = readFileSync(new URL('../../xano/bs_wallet_endpoints.xs', import.meta.url), 'utf8');
export const syncRecordFields = Object.fromEntries(source.split(/^---\s*$/m).flatMap(query => {
  const table = query.match(/query "sync\/([a-z_]+)" verb=POST/)?.[1];
  return table ? [[table, [...new Set([...query.matchAll(/\$input\.record\.([a-z_0-9]+)/g)].map(match => match[1]))].sort()]] : [];
})) as Record<string, string[]>;

export function missingRecordFields(table: string, record: Record<string, unknown>) {
  if (!syncRecordFields[table]) throw new Error(`Contrato desconhecido: ${table}`);
  return syncRecordFields[table].filter(field => !Object.hasOwn(record, field) || record[field] === undefined);
}

const openapi = JSON.parse(readFileSync(new URL('../fixtures/xano-openapi.json', import.meta.url), 'utf8'));
const snapshot = openapi.paths['/sync/bootstrap'].get.responses['200'].content['application/json'].schema.properties;
type Field = { nullable?: boolean; type?: string };
export function remoteFields(table: string): Record<string, Field> {
  const name = table === 'workspace_members' ? 'members' : table;
  const schema = snapshot[name];
  if (!schema) throw new Error(`Schema remoto desconhecido: ${table}`);
  return schema.items?.properties ?? schema.properties;
}
