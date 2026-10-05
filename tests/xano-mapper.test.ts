import { describe, expect, it } from 'vitest';
import { toSyncEnvelope } from '../src/data/xano/mapper';
import type { LocalChange, User } from '../src/domain/types';

const user: User = { id: '00000000-0000-4000-8000-000000000001', name: 'Teste', email: 'teste@example.com', username: 'teste', createdAt: '2026-01-01T00:00:00.000Z' };
const workspaceId = '00000000-0000-4000-8000-000000000002';

function change(entityType: string, payload: Record<string, unknown>): LocalChange {
  return { id: '00000000-0000-4000-8000-000000000003', entityType, entityId: String(payload.id), action: 'update', version: Number(payload.version ?? 1), createdAt: '2026-01-01T00:00:00.000Z', payload };
}

describe('mapeamento Xano', () => {
  it('converte escopo e status sem alterar o payload canônico', () => {
    const payload = { id: '00000000-0000-4000-8000-000000000004', workspaceId, ownerUserId: user.id, scope: 'personal', createdAt: '2026-01-01T00:00:00.000Z', createdBy: user.id, updatedAt: '2026-01-02T00:00:00.000Z', updatedBy: user.id, version: 2, syncStatus: 'local', name: 'Teste', amount: 1000, type: 'expense', status: 'pending', transactionDate: '2026-01-02', competenceDate: '2026-01-02', categoryId: '00000000-0000-4000-8000-000000000005', paymentMode: 'single' };
    const envelope = toSyncEnvelope(change('transactions', payload), workspaceId, user);
    expect(envelope.table).toBe('transactions');
    expect(envelope.record).toMatchObject({ scope: 'private', status: 'forecast', amount: 1000 });
    expect(envelope.payload).toEqual(payload);
  });

  it('traduz frequências compostas para o schema atual do Xano', () => {
    const payload = { id: '00000000-0000-4000-8000-000000000006', workspaceId, ownerUserId: user.id, scope: 'shared', createdAt: '2026-01-01T00:00:00.000Z', createdBy: user.id, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: user.id, version: 1, syncStatus: 'local', name: 'Trimestral', amount: 1000, type: 'expense', categoryId: '00000000-0000-4000-8000-000000000005', frequency: 'quarterly', customIntervalValue: 1, customIntervalUnit: 'month', startDate: '2026-01-01', nextOccurrenceDate: '2026-04-01', autoConfirm: false, active: true };
    const envelope = toSyncEnvelope(change('recurrences', payload), workspaceId, user);
    expect(envelope.record).toMatchObject({ frequency: 'custom', custom_interval_value: 3, custom_interval_unit: 'month' });
  });
});
