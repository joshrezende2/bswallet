import { capabilities, type Base, type Capability, type Context, type Member, type WalletState } from './types';
export const defaultPermissions: Capability[] = ['shared.read', 'shared.create', 'transactions.editOwn', 'attachments.read', 'reports.read'];
export function memberOf(state: WalletState, ctx: Context): Member {
  const member = state.members.find(m => m.userId === ctx.user.id && m.status === 'active');
  if (!member || state.id !== ctx.workspaceId) throw new Error('Você não tem acesso a esta família.');
  return member;
}
export function hasCapability(state: WalletState, ctx: Context, capability: Capability) {
  const member = memberOf(state, ctx);
  return member.role === 'master_admin' || member.permissions.includes(capability);
}
export function canRead(state: WalletState, ctx: Context, entity: Pick<Base, 'scope' | 'ownerUserId'>) {
  memberOf(state, ctx);
  if (entity.scope === 'personal') return entity.ownerUserId === ctx.user.id;
  return state.workspace.sharingEnabled && hasCapability(state, ctx, 'shared.read');
}
export function requireRead(state: WalletState, ctx: Context, entity: Pick<Base, 'scope' | 'ownerUserId'>) {
  if (!canRead(state, ctx, entity)) throw new Error('Você não tem acesso a este item.');
}
export function requireWrite(state: WalletState, ctx: Context, entity: Pick<Base, 'scope' | 'ownerUserId'>, capability: Capability, create = false) {
  requireRead(state, ctx, entity);
  if (entity.scope === 'personal') return;
  if (create && !hasCapability(state, ctx, 'shared.create')) throw new Error('Sem permissão para criar dados compartilhados.');
  if (!hasCapability(state, ctx, capability)) throw new Error('Seu perfil não permite esta ação.');
}
export function validateMemberChange(state: WalletState, ctx: Context, current: Member, next: Member) {
  const actor = memberOf(state, ctx);
  if (!hasCapability(state, ctx, 'members.manage')) throw new Error('Sem permissão para gerenciar membros.');
  if (current.userId === state.workspace.masterAdminUserId || current.role === 'master_admin') throw new Error('O Administrador Master não pode ser removido ou rebaixado.');
  if (next.role === 'master_admin' || next.userId !== current.userId || next.id !== current.id) throw new Error('Não é permitido transferir a propriedade.');
  if (actor.role !== 'master_admin' && (current.role === 'admin' || next.role !== 'member' || next.userId === actor.userId || next.permissions.some(p => !actor.permissions.includes(p)))) throw new Error('Somente o Master pode conceder administração ou permissões superiores.');
  if (next.permissions.some(p => !capabilities.includes(p))) throw new Error('Permissão inválida.');
}
