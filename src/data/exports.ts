import { auth } from './auth';
import { db } from './db';
import { accessibleState } from './wallet-service';
import { hasCapability } from '../domain/permissions';
import { dateBR, financialDate, money } from '../domain/finance';
import type { Context, Transaction, Transfer, WalletState } from '../domain/types';
type Row = (Transaction & { rowType: 'transaction' }) | (Transfer & { rowType: 'transfer' });
export function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function exportState(ctx: Context) {
  await auth.requireUser(ctx.user.id); const raw = await db.wallets.get(ctx.workspaceId); if (!raw) throw new Error('Família não encontrada.');
  const state = accessibleState(raw, ctx);
  if (!hasCapability(raw, ctx, 'reports.read')) {
    for (const key of ['transactions', 'transfers', 'categories', 'cards', 'people', 'accounts', 'budgets', 'recurrences', 'invoices', 'installmentGroups'] as const) (state[key] as { scope: string }[]) = state[key].filter(v => v.scope === 'personal');
    state.audit = state.audit.filter(a => a.scope === 'personal'); state.trash = state.trash.filter(t => t.snapshot.scope === 'personal');
  }
  return state;
}
const headers = ['Data', 'Nome', 'Tipo', 'Status', 'Valor (R$)', 'Categoria', 'Pessoa', 'Conta', 'Cartão', 'Parcela', 'Fatura', 'Observações'];
const formulaSafe = (value: string) => /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
function rowsFor(state: WalletState, rows: Row[]) {
  const allowed = new Set([...state.transactions, ...state.transfers].map(t => t.id));
  return rows.filter(t => allowed.has(t.id)).map(item => {
    const tx = item.rowType === 'transaction' ? state.transactions.find(t => t.id === item.id)! : null;
    const transfer = item.rowType === 'transfer' ? state.transfers.find(t => t.id === item.id)! : null;
    const row = tx ?? transfer!;
    return [dateBR(tx ? financialDate(tx) : transfer!.date), formulaSafe(row.name), tx ? tx.type === 'income' ? 'Receita' : 'Despesa' : 'Transferência', tx ? ({ confirmed: 'Confirmado', pending: 'Pendente', forecast: 'Previsão', cancelled: 'Cancelado' }[tx.status]) : 'Registrada', row.amount / 100,
      state.categories.find(c => c.id === tx?.categoryId)?.name ?? '', state.people.find(p => p.id === row.personId)?.name ?? '', transfer ? `${state.accounts.find(a => a.id === transfer.fromAccountId)?.name} → ${state.accounts.find(a => a.id === transfer.toAccountId)?.name}` : state.accounts.find(a => a.id === tx?.accountId)?.name ?? '',
      state.cards.find(c => c.id === tx?.cardId)?.name ?? '', tx?.installmentNumber ? `${tx.installmentNumber}/${tx.installmentTotal}` : '', state.invoices.find(i => i.id === tx?.invoiceId)?.cycleMonth ?? '', formulaSafe(row.notes ?? '')];
  });
}
export async function exportCSV(ctx: Context, rows: Row[]) {
  const state = await exportState(ctx);
  const lines = [headers, ...rowsFor(state, rows)].map(row => row.map(value => `"${(typeof value === 'number' ? value.toFixed(2).replace('.', ',') : formulaSafe(String(value))).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadBlob(new Blob(['\uFEFF' + lines], { type: 'text/csv;charset=utf-8' }), 'bs-wallet-lancamentos.csv');
}
export async function exportExcel(ctx: Context, rows: Row[]) {
  const state = await exportState(ctx), { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'BS Wallet'; const sheet = workbook.addWorksheet('Lançamentos');
  sheet.columns = headers.map(header => ({ header, width: header === 'Nome' ? 35 : 21 }));
  for (const row of rowsFor(state, rows)) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008847' } };
  sheet.getColumn(5).numFmt = '"R$" #,##0.00'; sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = { from: 'A1', to: 'L1' };
  downloadBlob(new Blob([await workbook.xlsx.writeBuffer() as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'bs-wallet-lancamentos.xlsx');
}
export async function exportPDF(ctx: Context, rows: Row[], filters: string) {
  const state = await exportState(ctx), [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ orientation: 'landscape' });
  const allowedIds = new Set(state.transactions.map(t => t.id));
  const selectedIds = new Set(rows.filter(r => r.rowType === 'transaction' && allowedIds.has(r.id)).map(t => t.id));
  const confirmed = state.transactions.filter(t => selectedIds.has(t.id) && t.status === 'confirmed');
  const income = confirmed.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), expense = confirmed.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  pdf.setFontSize(22); pdf.setTextColor('#008847'); pdf.text('BS Wallet', 14, 19); pdf.setTextColor('#17201B'); pdf.setFontSize(11);
  pdf.text('Relatório financeiro • ' + state.workspace.name, 14, 29);
  pdf.text(pdf.splitTextToSize(filters, 264), 14, 37);
  pdf.text(`Receitas confirmadas: ${money(income)}   |   Despesas confirmadas: ${money(expense)}   |   Saldo: ${money(income - expense)}`, 14, 49);
  const data = rowsFor(state, rows).map(row => [row[0], row[1], row[2], row[3], money(Math.round(Number(row[4]) * 100)), row[5], row[6], row[8], row[9]]);
  autoTable(pdf, { head: [['Data', 'Descrição', 'Tipo', 'Status', 'Valor', 'Categoria', 'Pessoa', 'Cartão', 'Parcela']], body: data, startY: 56, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [0, 136, 71] }, alternateRowStyles: { fillColor: [246, 250, 248] }, margin: { bottom: 19 }, didDrawPage: () => { pdf.setFontSize(8); pdf.text('Valores registrados no app. Não representam saldo bancário confirmado. Transferências não compõem receitas/despesas.', 14, 201); pdf.text(String(pdf.getCurrentPageInfo().pageNumber), 280, 201); } });
  pdf.save('bs-wallet-relatorio.pdf');
}
