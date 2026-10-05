import { z } from 'zod';
import { capabilities } from '../domain/types';
import { xanoApi } from './xano/client';

const timestamp = z.union([z.number(), z.string()]).transform(value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('O servidor retornou uma data de convite inválida.');
  return date.toISOString();
});
const inviteRole = z.enum(['admin', 'member']);
const inviteSchema = z.object({
  id: z.string().min(1), workspace_id: z.string().min(1), email: z.string(), role: inviteRole,
  permissions: z.array(z.enum(capabilities)), status: z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired']),
  created_at: timestamp, updated_at: timestamp.optional(), expires_at: timestamp,
  accepted_at: timestamp.nullish(), send_count: z.number(), workspace_name: z.string().optional(),
});
const generatedSchema = z.object({ invite: inviteSchema, token: z.string().min(1) });
const resolvedSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(false) }),
  z.object({ valid: z.literal(true), workspace_name: z.string(), role: inviteRole, masked_email: z.string(), expires_at: timestamp }),
]);
const acceptedSchema = z.object({ ok: z.literal(true), workspace_id: z.string().min(1), membership_id: z.string().min(1) });
const okSchema = z.object({ ok: z.literal(true) });
const createSchema = z.object({ workspace_id: z.string().min(1), email: z.string().trim().toLowerCase().email(), role: inviteRole, permissions: z.array(z.enum(capabilities)) });
const targetSchema = z.union([
  z.object({ token: z.string().min(1) }).strict(),
  z.object({ invite_id: z.string().min(1) }).strict(),
]);
export type WorkspaceInvite = z.infer<typeof inviteSchema>;
export type CreateInviteInput = z.input<typeof createSchema>;
export type GeneratedInvite = z.infer<typeof generatedSchema>;
export type ResolvedInvite = z.infer<typeof resolvedSchema>;
export type InviteTarget = { token: string; invite_id?: never } | { invite_id: string; token?: never };

// Convites são exclusivamente online; tokens existem apenas na URL e na memória da tela.
async function request<S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown, authenticated = true): Promise<z.output<S>> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Conecte-se à internet para gerenciar convites.');
  const response = await xanoApi<unknown>(`/workspace/invites/${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }, authenticated);
  const result = schema.safeParse(response);
  if (!result.success) throw new Error('O servidor retornou um convite em formato inesperado. Tente atualizar a página.');
  return result.data;
}
export const createInvite = async (input: CreateInviteInput) => request('create', generatedSchema, createSchema.parse(input));
export const pendingInvites = () => request('pending', z.array(inviteSchema));
export const resolveInvite = (token: string) => request('resolve', resolvedSchema, { token }, false);
export const acceptInvite = async (target: InviteTarget) => request('accept', acceptedSchema, targetSchema.parse(target));
export const declineInvite = async (target: InviteTarget) => request('decline', okSchema, targetSchema.parse(target));
export const listWorkspaceInvites = (workspaceId: string) => request(`list?workspace_id=${encodeURIComponent(workspaceId)}`, z.array(inviteSchema));
export const revokeInvite = (inviteId: string) => request('revoke', okSchema, { invite_id: inviteId });
export const regenerateInvite = (inviteId: string) => request('regenerate', generatedSchema, { invite_id: inviteId });
