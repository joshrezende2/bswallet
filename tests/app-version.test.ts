import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, isNewerVersion, latestPublishedVersion } from '../src/data/app-version';

describe('versão e atualização do aplicativo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('usa a versão do package.json incorporada ao build', () => {
    expect(APP_VERSION).toBe('0.1.1');
  });

  it('compara versões sem tratar downgrade como atualização', () => {
    expect(isNewerVersion('0.1.2', '0.1.1')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.1.1', '0.1.1')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(false);
  });

  it('consulta somente o endpoint público de versão sem usar cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: '0.1.1', published_at: 1791384958000, published: true, active: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(latestPublishedVersion()).resolves.toMatchObject({ version: '0.1.1', active: true, published: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/settings\/last$/);
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });
});
