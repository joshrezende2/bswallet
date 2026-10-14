import { useState } from 'react';
import { APP_VERSION } from '../data/app-version';

export const APP_UPDATE_REQUEST = 'bs-wallet:check-for-update';

export interface AppUpdateRequestDetail {
  complete(message: string): void;
}

export function AppVersionButton({ suffix = '', className = 'app-version' }: { suffix?: string; className?: string }) {
  const [status, setStatus] = useState('');
  const check = () => {
    setStatus('Verificando atualização…');
    window.dispatchEvent(new CustomEvent<AppUpdateRequestDetail>(APP_UPDATE_REQUEST, {
      detail: { complete: message => setStatus(message) },
    }));
  };
  return <>
    <button type="button" className={className} onClick={check} disabled={status === 'Verificando atualização…'} aria-label={`Verificar atualização do BS Wallet, versão atual ${APP_VERSION}`}>
      v{APP_VERSION}{suffix}
    </button>
    <span className="visually-hidden" role="status" aria-live="polite">{status}</span>
  </>;
}
