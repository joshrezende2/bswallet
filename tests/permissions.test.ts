import { describe, expect, it } from 'vitest';
import { emptyWallet } from '../src/data/factory';
import { canRead, requireWrite, validateMemberChange } from '../src/domain/permissions';
import type { Context, Member, User } from '../src/domain/types';

const master: User = { id: 'master', name: 'Master', email: 'master@example.com', username: 'master', createdAt: '2026-01-01T00:00:00.000Z' };
const memberUser: User = { id: 'member', name: 'Membro', email: 'member@example.com', username: 'member', createdAt: '2026-01-01T00:00:00.000Z' };
const privateItem = { scope: 'personal' as const, ownerUserId: master.id };

describe('escopos e permissões', () => {
  it('protege dados pessoais de outros membros', () => {
    const state = emptyWallet(master);
    state.members.push({ id: 'member-record', userId: memberUser.id, name: memberUser.name, email: memberUser.email, role: 'member', permissions: ['shared.read'], status: 'active' });
    const context: Context = { user: memberUser, workspaceId: state.id };
    expect(canRead(state, context, privateItem)).toBe(false);
    expect(() => requireWrite(state, context, { scope: 'shared', ownerUserId: master.id }, 'transactions.editOthers')).toThrow('perfil');
  });

  it('impede que qualquer administrador remova ou rebaixe o Master', () => {
    const state = emptyWallet(master);
    const context: Context = { user: master, workspaceId: state.id };
    const current = state.members[0];
    const demoted: Member = { ...current, role: 'member' };
    expect(() => validateMemberChange(state, context, current, demoted)).toThrow('Master');
  });
});
