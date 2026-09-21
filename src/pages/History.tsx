import { useMemo, useState } from 'react';
import { Download, Search, SlidersHorizontal, X } from 'lucide-react';
import { useWallet } from '../components/WalletContext';
import { financialDate, money, normalize, parseMoney } from '../domain/finance';
import { TransactionList, type HistoryItem } from '../components/TransactionList';
import { Button, Field, statusLabels } from '../components/ui';
import { hasCapability } from '../domain/permissions';
export function History() {
  const { ctx, state, month, scope, run } = useWallet();
  const [query, setQuery] = useState(''), [expanded, setExpanded] = useState(false), [type, setType] = useState(''), [status, setStatus] = useState(''), [category, setCategory] = useState(''), [person, setPerson] = useState(''), [card, setCard] = useState(''), [account, setAccount] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [allMonths, setAllMonths] = useState(false), [sort, setSort] = useState('newest');
  function clear() { setQuery(''); setType(''); setStatus(''); setCategory(''); setPerson(''); setCard(''); setAccount(''); setFrom(''); setTo(''); setAllMonths(false); }
  const items = useMemo(() => {
    let exactAmount: number | undefined; try { if (/\d/.test(query)) exactAmount = parseMoney(query); } catch { /* Free text search. */ }
    const rows: HistoryItem[] = [...state.transactions.map(t => ({ ...t, rowType: 'transaction' as const })), ...state.transfers.map(t => ({ ...t, rowType: 'transfer' as const }))];
    const result = rows.filter(item => {
      const tx = item.rowType === 'transaction' ? item : null, transfer = item.rowType === 'transfer' ? item : null;
      const date = tx ? financialDate(tx) : transfer!.date;
      if (item.scope !== scope || !allMonths && !date.startsWith(month) || from && date < from || to && date > to) return false;
      if (type && type !== (tx?.type ?? 'transfer') || status && status !== tx?.status || category && category !== tx?.categoryId || person && person !== item.personId || card && card !== tx?.cardId || account && account !== tx?.accountId && account !== transfer?.fromAccountId && account !== transfer?.toAccountId) return false;
      const text = [item.name, item.notes, money(item.amount), state.categories.find(c => c.id === tx?.categoryId)?.name, state.people.find(p => p.id === item.personId)?.name, state.cards.find(c => c.id === tx?.cardId)?.name, state.accounts.filter(a => [tx?.accountId, transfer?.fromAccountId, transfer?.toAccountId].includes(a.id)).map(a => a.name).join(' ')].join(' ');
      return normalize(text).includes(normalize(query)) || item.amount === exactAmount;
    });
    const date = (item: HistoryItem) => item.rowType === 'transaction' ? financialDate(item) : item.date;
    return result.sort((a, b) => sort === 'largest' ? b.amount - a.amount : sort === 'smallest' ? a.amount - b.amount : sort === 'oldest' ? date(a).localeCompare(date(b)) : date(b).localeCompare(date(a)));
  }, [state, month, scope, query, type, status, category, person, card, account, from, to, allMonths, sort]);
  const select = (label: string, value: string, change: (v: string) => void, entries: { id: string; name: string }[]) => <Field label={label}><select value={value} onChange={e => change(e.target.value)}><option value="">Todos</option>{entries.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>;
  return <section className="panel history-panel"><div className="history-toolbar"><div className="search-box"><Search size={18} /><input aria-label="Buscar no histórico" placeholder="Buscar por nome, categoria, pessoa ou valor…" value={query} onChange={e => setQuery(e.target.value)} /></div><Button variant="secondary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><SlidersHorizontal size={16} />Filtros</Button>{(scope === 'personal' || hasCapability(state, ctx, 'reports.read')) && <Button variant="secondary" onClick={() => run(async () => { const { exportCSV } = await import('../data/exports'); await exportCSV(ctx, items); }, 'CSV exportado com os filtros atuais.')}><Download size={16} />CSV</Button>}</div>
  {expanded && <div className="filter-grid">{select('Tipo', type, setType, [{ id: 'expense', name: 'Despesa' }, { id: 'income', name: 'Receita' }, { id: 'transfer', name: 'Transferência' }])}{select('Status', status, setStatus, Object.entries(statusLabels).map(([id, name]) => ({ id, name })))}{select('Categoria', category, setCategory, state.categories)}{select('Pessoa', person, setPerson, state.people)}{select('Cartão', card, setCard, state.cards)}{select('Conta', account, setAccount, state.accounts)}<Field label="De"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="Até"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field><label className="check"><input type="checkbox" checked={allMonths} onChange={e => setAllMonths(e.target.checked)} />Todos os meses</label><button className="text-button" onClick={clear}><X size={15} />Limpar filtros</button></div>}
  <div className="table-meta"><span>{items.length} {items.length === 1 ? 'lançamento' : 'lançamentos'} encontrados</span><select aria-label="Ordenar histórico" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Mais recentes</option><option value="oldest">Mais antigos</option><option value="largest">Maior valor</option><option value="smallest">Menor valor</option></select></div><TransactionList items={items} />
  </section>;
}
