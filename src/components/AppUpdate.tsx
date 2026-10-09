import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from '../data/db';
import { APP_VERSION, isNewerVersion, latestPublishedVersion } from '../data/app-version';
import { Button } from './ui';

const CHECK_INTERVAL = 15 * 60 * 1000;

function useDirtyForms() {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const refresh = () => setDirty(Boolean(document.querySelector('form[data-dirty="true"]')));
    const mark = (event: Event) => {
      const form = (event.target as HTMLElement | null)?.closest('form');
      if (form) form.dataset.dirty = 'true';
      refresh();
    };
    const clear = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (form?.matches('form')) delete form.dataset.dirty;
      refresh();
    };
    document.addEventListener('input', mark, true);
    document.addEventListener('change', mark, true);
    document.addEventListener('submit', clear, true);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener('input', mark, true);
      document.removeEventListener('change', mark, true);
      document.removeEventListener('submit', clear, true);
    };
  }, []);
  return dirty;
}

export function AppUpdate() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [availableVersion, setAvailableVersion] = useState('');
  const [pending, setPending] = useState(0);
  const dirty = useDirtyForms();
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_url, currentRegistration) => { if (currentRegistration) registration.current = currentRegistration; },
  });

  const check = useCallback(async () => {
    if (!navigator.onLine || document.visibilityState === 'hidden') return;
    const controller = new AbortController();
    try {
      const latest = await latestPublishedVersion(controller.signal);
      if (isNewerVersion(latest.version)) {
        setAvailableVersion(latest.version);
        const currentRegistration = registration.current ?? await navigator.serviceWorker?.ready;
        await currentRegistration?.update();
      }
    } catch {
      // Update checks must never interrupt the local-first application.
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => { void check(); }, CHECK_INTERVAL);
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [check]);

  useEffect(() => {
    if (!needRefresh) return;
    void db.wallets.toArray().then(wallets => setPending(wallets.reduce((total, wallet) => total + wallet.outbox.length, 0)));
  }, [needRefresh]);

  if (!needRefresh) return null;
  return <div className="update-banner app-update" role="status">
    <span>
      <strong>{availableVersion ? `BS Wallet v${availableVersion} disponível.` : 'Nova versão do BS Wallet disponível.'}</strong>
      {dirty ? ' Salve ou feche o formulário aberto para atualizar.' : pending ? ` ${pending} alteração${pending === 1 ? '' : 'ões'} pendente${pending === 1 ? '' : 's'} continuará${pending === 1 ? '' : 'ão'} salva${pending === 1 ? '' : 's'} neste dispositivo.` : ' Seus dados locais serão preservados.'}
    </span>
    <Button variant="secondary" disabled={dirty} onClick={() => updateServiceWorker(true)}>Atualizar agora</Button>
    <button className="icon-button" aria-label="Atualizar depois" onClick={() => setNeedRefresh(false)}>×</button>
    <small className="visually-hidden">Versão instalada: {APP_VERSION}</small>
  </div>;
}
