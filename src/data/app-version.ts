import { z } from 'zod';
import { xanoConfig } from './xano/config';

export const APP_VERSION = __APP_VERSION__;

const publishedVersionSchema = z.object({
  version: z.string().trim().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  published_at: z.union([z.string(), z.number()]).optional(),
  published: z.boolean().optional(),
  active: z.boolean().optional(),
});

export type PublishedVersion = z.infer<typeof publishedVersionSchema>;

export async function latestPublishedVersion(signal?: AbortSignal): Promise<PublishedVersion> {
  if (!xanoConfig.apiBaseUrl) throw new Error('Endpoint de versão indisponível.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = globalThis.setTimeout(abort, 10_000);
  try {
    const response = await fetch(`${xanoConfig.apiBaseUrl}/settings/last`, {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Não foi possível consultar a versão publicada (HTTP ${response.status}).`);
    const payload: unknown = await response.json();
    return publishedVersionSchema.parse(payload);
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function versionParts(version: string) {
  return version.split(/[+-]/, 1)[0].split('.').map(value => Number(value));
}

export function isNewerVersion(candidate: string, current = APP_VERSION) {
  const next = versionParts(candidate), installed = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}
