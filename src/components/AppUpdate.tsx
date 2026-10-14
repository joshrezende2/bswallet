import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from '../data/db';
import { APP_VERSION, isNewerVersion, latestPublishedVersion } from '../data/app-version';
import { Button } from './ui';
import { APP_UPDATE_REQUEST, type AppUpdateRequestDetail } from './AppVersionButton';

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
  const [manualStatus, setManualStatus] = useState('');
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

  const check = useCallback(async (manual = false) => {
    if (!navigator.onLine || (!manual && document.visibilityState === 'hidden')) return 'Não foi possível verificar agora: o aplicativo está offline.';
    const controller = new AbortController();
    try {
      const currentRegistration = registration.current ?? await navigator.serviceWorker?.getRegistration();
      await currentRegistration?.update();
      const latest = await latestPublishedVersion(controller.signal).catch(() => null);
      if (latest && isNewerVersion(latest.version)) setAvailableVersion(latest.version);
      if (currentRegistration?.waiting) {
        await updateServiceWorker(true);
        return 'Atualização instalada. Recarregando…';
      }
      return latest && isNewerVersion(latest.version) ? `A versão ${latest.version} está sendo preparada.` : 'Você já está usando a versão mais recente.';
    } catch {
      // Update checks must never interrupt the local-first application.
      return 'Não foi possível verificar a atualização agora.';
    }
  }, [updateServiceWorker]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => { void check(); }, CHECK_INTERVAL);
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    const online = () => { void check(); };
    const focus = () => { void check(); };
    const requested = (event: Event) => {
      const detail = (event as CustomEvent<AppUpdateRequestDetail>).detail;
      setManualStatus('Verificando atualização…');
      void check(true).then(message => { setManualStatus(message); detail?.complete(message); });
    };
    window.addEventListener('online', online);
    window.addEventListener('focus', focus);
    window.addEventListener(APP_UPDATE_REQUEST, requested);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', focus);
      window.removeEventListener(APP_UPDATE_REQUEST, requested);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [check]);

  useEffect(() => {
    if (!needRefresh) return;
    void db.wallets.toArray().then(wallets => setPending(wallets.reduce((total, wallet) => total + wallet.outbox.length, 0)));
  }, [needRefresh]);

  if (!needRefresh) return manualStatus ? <div className="update-banner app-update" role="status">
    <span><strong>{manualStatus}</strong></span>
    <button className="icon-button" aria-label="Fechar aviso de atualização" onClick={() => setManualStatus('')}>×</button>
  </div> : null;
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
