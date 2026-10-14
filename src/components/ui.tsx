import { useCallback, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Accessibility, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, BadgeDollarSign, Baby, BriefcaseBusiness, Bus, Car, ChartNoAxesCombined, CircleEllipsis, CircleHelp, CirclePlus, CreditCard, Droplets, Dumbbell, FileText, Fuel, Gift, GraduationCap, HandCoins, Heart, House, KeyRound, Landmark, Laptop, PawPrint, PiggyBank, Pill, Plane, ReceiptText, Scissors, ShieldCheck, Shirt, ShoppingCart, Sparkles, Store, Tv, Utensils, Wallet, Wifi, Wrench, X, Zap } from 'lucide-react';
import type { Status } from '../domain/types';
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) { return <button {...props} className={`button ${variant} ${className}`} />; }
export function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
let viewportZoomLocks = 0;
let viewportBeforeZoomLock: string | undefined;
let bodyScrollLocks = 0;
let bodyScrollY = 0;
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
function lockBodyScroll() {
  if (bodyScrollLocks === 0) {
    bodyScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.inset = `-${bodyScrollY}px 0 0`;
    document.body.style.width = '100%';
  }
  bodyScrollLocks += 1;
  return () => {
    bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
    if (bodyScrollLocks === 0) {
      document.body.style.position = '';
      document.body.style.inset = '';
      document.body.style.width = '';
      window.scrollTo(0, bodyScrollY);
    }
  };
}
export function Modal({ title, children, onClose, wide = false, preventViewportZoom = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; preventViewportZoom?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; const unlock = lockBodyScroll(); dialog.showModal(); return () => { dialog.close(); unlock(); }; }, []);
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
export const categoryIcons = {
  shopping: ['Carrinho', ShoppingCart], utensils: ['Alimentação', Utensils], car: ['Carro', Car], bus: ['Transporte público', Bus], fuel: ['Combustível', Fuel],
  home: ['Casa', House], wrench: ['Manutenção', Wrench], zap: ['Energia', Zap], droplets: ['Água', Droplets], wifi: ['Internet', Wifi],
  heart: ['Saúde', Heart], pill: ['Farmácia', Pill], baby: ['Crianças', Baby], accessibility: ['Cuidados', Accessibility], paw: ['Pets', PawPrint],
  graduation: ['Educação', GraduationCap], tv: ['Streaming', Tv], sparkles: ['Lazer', Sparkles], plane: ['Viagem', Plane], shirt: ['Roupas', Shirt],
  scissors: ['Cuidados pessoais', Scissors], dumbbell: ['Esportes', Dumbbell], shield: ['Seguro', ShieldCheck], landmark: ['Impostos', Landmark],
  'hand-coins': ['Dívidas', HandCoins], laptop: ['Tecnologia', Laptop], gift: ['Presentes', Gift], wallet: ['Carteira', Wallet],
  briefcase: ['Trabalho', BriefcaseBusiness], 'badge-dollar': ['Benefícios', BadgeDollarSign], 'piggy-bank': ['Aposentadoria', PiggyBank], key: ['Aluguel', KeyRound],
  chart: ['Investimentos', ChartNoAxesCombined], store: ['Vendas', Store], receipt: ['Reembolso', ReceiptText], 'circle-ellipsis': ['Outros', CircleEllipsis],
  'circle-plus': ['Outras receitas', CirclePlus], card: ['Cartão', CreditCard], file: ['Documento', FileText], transfer: ['Transferência', ArrowLeftRight],
  income: ['Receita', ArrowUpRight], expense: ['Despesa', ArrowDownLeft],
} as const;
const icons = Object.fromEntries(Object.entries(categoryIcons).map(([name, [, Icon]]) => [name, Icon]));
export function CategoryIcon({ name = 'wallet', size = 19 }: { name?: string; size?: number }) { const Icon = icons[name as keyof typeof icons] ?? CircleHelp; return <Icon size={size} strokeWidth={1.8} />; }
export function Brand() { return <div className="brand"><img src="/favicon.svg" width="38" height="38" alt="" /><span>BS Wallet</span></div>; }
export function ErrorText({ error }: { error?: string }) { return error ? <p role="alert" className="error-message">{error}</p> : null; }
export const statusLabels: Record<Status, string> = { confirmed: 'Confirmado', pending: 'Pendente', forecast: 'Previsão', cancelled: 'Cancelado' };
export const frequencyLabels = { weekly: 'Semanal', biweekly: 'Quinzenal (14 dias)', monthly: 'Mensal', bimonthly: 'Bimestral', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado' };
