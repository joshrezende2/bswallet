const clean = (value: string | undefined) => value?.trim().replace(/\/+$/, '') ?? '';

export const xanoConfig = {
  enabled: import.meta.env.VITE_XANO_SYNC_ENABLED === 'true',
  apiBaseUrl: clean(import.meta.env.VITE_XANO_API_BASE_URL),
  authBaseUrl: clean(import.meta.env.VITE_XANO_AUTH_BASE_URL),
};

export const xanoReady = () => Boolean(xanoConfig.enabled && xanoConfig.apiBaseUrl && xanoConfig.authBaseUrl);
