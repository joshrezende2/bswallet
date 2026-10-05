import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, 'true', 'false'])('configuração sem URLs e enabled=%s', async enabled => {
  vi.resetModules();
  vi.stubEnv('VITE_XANO_SYNC_ENABLED', enabled);
  vi.stubEnv('VITE_XANO_AUTH_BASE_URL', undefined);
  vi.stubEnv('VITE_XANO_API_BASE_URL', undefined);
  const { xanoConfig, xanoReady } = await import('../src/data/xano/config');
  expect(xanoConfig.authBaseUrl).toBe('https://xano.ab1midia.com.br/api:iJuDN1w_');
  expect(xanoConfig.apiBaseUrl).toBe('https://xano.ab1midia.com.br/api:A-AE1sTc');
  expect(xanoReady()).toBe(enabled !== 'false');
});

it('aceita overrides públicos por ambiente e remove barras finais', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_XANO_SYNC_ENABLED', 'true');
  vi.stubEnv('VITE_XANO_AUTH_BASE_URL', ' https://auth.test/ ');
  vi.stubEnv('VITE_XANO_API_BASE_URL', 'https://api.test/');
  const { xanoConfig } = await import('../src/data/xano/config');
  expect(xanoConfig.authBaseUrl).toBe('https://auth.test');
  expect(xanoConfig.apiBaseUrl).toBe('https://api.test');
});
