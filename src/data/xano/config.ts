const clean = (value: string | undefined) => value?.trim().replace(/\/+$/, '') ?? '';

export const xanoConfig = {
  enabled: import.meta.env.VITE_XANO_SYNC_ENABLED !== 'false',
  apiBaseUrl: clean(import.meta.env.VITE_XANO_API_BASE_URL) || 'https://xano.ab1midia.com.br/api:A-AE1sTc',
  authBaseUrl: clean(import.meta.env.VITE_XANO_AUTH_BASE_URL) || 'https://xano.ab1midia.com.br/api:iJuDN1w_',
};

export const xanoReady = () => Boolean(xanoConfig.enabled && xanoConfig.apiBaseUrl && xanoConfig.authBaseUrl);
