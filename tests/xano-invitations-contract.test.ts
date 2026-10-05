import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sync = readFileSync(new URL('../xano/bs_wallet_endpoints.xs', import.meta.url), 'utf8');
const invites = readFileSync(new URL('../xano/bs_wallet_invites.xs', import.meta.url), 'utf8');
const queryBlocks = (source: string) => source.split(/^---\s*$/m).filter(block => /query "/.test(block));

describe('contratos versionados Xano (inspeção estática, não execução do servidor)', () => {
  it('todos os endpoints financeiros aceitam import, operação legítima da outbox de backup', () => {
    const financial = queryBlocks(sync).filter(block => /query "sync\/(people|categories|accounts|cards|recurrences|invoices|transactions|budgets|transfers|installment_groups)" verb=POST/.test(block));
    expect(financial).toHaveLength(10);
    for (const block of financial) {
      const actionGuard = block.match(/precondition \(([^\n]*\$input\.action == "create"[^\n]*)\)/)?.[1];
      expect(actionGuard, block.match(/query "([^"]+)"/)?.[1]).toContain('$input.action == "import"');
    }
  });

  it('expõe os oito contratos esperados e exige usuário em todos exceto resolve', () => {
    const blocks = queryBlocks(invites);
    expect(blocks).toHaveLength(8);
    expect(blocks.map(block => block.match(/query "workspace\/invites\/([^"]+)"/)?.[1]).sort()).toEqual(['accept', 'create', 'decline', 'list', 'pending', 'regenerate', 'resolve', 'revoke']);
    for (const block of blocks) {
      if (block.includes('query "workspace/invites/resolve"')) expect(block).not.toContain('auth = "user"');
      else expect(block).toContain('auth = "user"');
    }
  });

  it('consulta pendentes pela identidade autenticada e não aceita email de consulta', () => {
    const pending = queryBlocks(invites).find(block => block.includes('query "workspace/invites/pending"'))!;
    const input = pending.match(/input\s*\{([^}]*)\}/)?.[1];
    expect(input?.trim()).toBe('');
    expect(pending).toContain('field_value = $auth.id');
    expect(pending).toContain('$db.workspace_invites.email == $actor_email');
    expect(pending).not.toContain('$input.email');
  });

  it('listas de campos retornáveis nunca incluem token ou hash', () => {
    const lists = [...invites.matchAll(/(?:pick:|output\s*=\s*)(\[[^\]]*\])/g)];
    expect(lists.length).toBeGreaterThan(8);
    for (const list of lists) expect(list[1]).not.toMatch(/"token(?:_hash)?"/);
    for (const audit of invites.matchAll(/db\.add "audit_logs"\s*\{([\s\S]*?)\n\s*\}/g)) {
      expect(audit[1]).not.toContain('$token');
      expect(audit[1]).not.toContain('token_hash');
    }
  });
});
