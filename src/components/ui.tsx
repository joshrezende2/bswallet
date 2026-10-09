import { useCallback, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, BriefcaseBusiness, Car, CircleHelp, CreditCard, FileText, Heart, House, ShoppingCart, Sparkles, Utensils, Wallet, X } from 'lucide-react';
import type { Status } from '../domain/types';
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) { return <button {...props} className={`button ${variant} ${className}`} />; }
export function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
let viewportZoomLocks = 0;
let viewportBeforeZoomLock: string | undefined;
function lockViewportZoom() {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return () => undefined;
  if (viewportZoomLocks === 0) {
    viewportBeforeZoomLock = viewport.content;
    const content = viewport.content.split(',').map(value => value.trim()).filter(value => value && !/^user-scalable\s*=/i.test(value));
    viewport.content = [...content, 'user-scalable=no'].join(', ');
  }
  viewportZoomLocks += 1;
  return () => {
    viewportZoomLocks = Math.max(0, viewportZoomLocks - 1);
    if (viewportZoomLocks === 0 && viewportBeforeZoomLock !== undefined) {
      viewport.content = viewportBeforeZoomLock;
      viewportBeforeZoomLock = undefined;
    }
  };
}
export function Modal({ title, children, onClose, wide = false, preventViewportZoom = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; preventViewportZoom?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  useEffect(() => preventViewportZoom ? lockViewportZoom() : undefined, [preventViewportZoom]);
  return createPortal(<dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><header className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20} /></button></header>{children}</div></dialog>, document.body);
}
interface ConfirmationRequest { title: string; description: string; confirmLabel?: string; resolve: (confirmed: boolean) => void; }
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const confirm = useCallback((options: Omit<ConfirmationRequest, 'resolve'>) => new Promise<boolean>(resolve => setRequest({ ...options, resolve })), []);
  const close = useCallback((confirmed: boolean) => {
    setRequest(current => { current?.resolve(confirmed); return null; });
  }, []);
  const confirmation = request ? <Modal title={request.title} onClose={() => close(false)}><p>{request.description}</p><footer className="form-actions"><Button variant="secondary" onClick={() => close(false)}>Cancelar</Button><Button variant="danger" onClick={() => close(true)}>{request.confirmLabel ?? 'Confirmar'}</Button></footer></Modal> : null;
  return { confirm, confirmation };
}
export function Empty({ title = 'Tudo pronto para começar', description = 'Seus registros aparecerão aqui.', action }: { title?: string; description?: string; action?: ReactNode }) { return <div className="empty"><span className="empty-icon"><Wallet size={28} /></span><h3>{title}</h3><p>{description}</p>{action}</div>; }
export function StatusBadge({ status }: { status: Status | string }) { const labels: Record<string, string> = { confirmed: 'Confirmado', pending: 'Pendente', forecast: 'Previsão', cancelled: 'Cancelado' }; return <span className={`status ${status}`}>{labels[status] ?? status}</span>; }
const icons = { shopping: ShoppingCart, utensils: Utensils, car: Car, home: House, heart: Heart, sparkles: Sparkles, wallet: Wallet, briefcase: BriefcaseBusiness, card: CreditCard, file: FileText, transfer: ArrowLeftRight, income: ArrowUpRight, expense: ArrowDownLeft };
export function CategoryIcon({ name = 'wallet', size = 19 }: { name?: string; size?: number }) { const Icon = icons[name as keyof typeof icons] ?? CircleHelp; return <Icon size={size} strokeWidth={1.8} />; }
export function Brand() { return <div className="brand"><img src="/favicon.svg" width="38" height="38" alt="" /><span>BS Wallet</span></div>; }
export function ErrorText({ error }: { error?: string }) { return error ? <p role="alert" className="error-message">{error}</p> : null; }
export const statusLabels: Record<Status, string> = { confirmed: 'Confirmado', pending: 'Pendente', forecast: 'Previsão', cancelled: 'Cancelado' };
export const frequencyLabels = { weekly: 'Semanal', biweekly: 'Quinzenal (14 dias)', monthly: 'Mensal', bimonthly: 'Bimestral', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado' };
