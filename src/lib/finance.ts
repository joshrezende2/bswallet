import type { Card, Frequency, Transaction } from "./types";

export function clampDay(year: number, month: number, day: number): Date {
  // month: 1-12
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(day, last));
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export interface InvoiceCycle {
  cardId: string;
  cycleYear: number;
  cycleMonth: number;
  closingDate: string;
  dueDate: string;
  invoiceId: string;
}

/** Ciclo de fatura ao qual uma compra pertence, respeitando o dia de fechamento. */
export function invoiceCycleFor(card: Card, purchaseDate: string): InvoiceCycle {
  const d = parseISODate(purchaseDate);
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  const closingThisMonth = clampDay(year, month, card.closingDay);
  if (d.getTime() > closingThisMonth.getTime()) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return buildCycle(card, year, month);
}

export function buildCycle(card: Card, year: number, month: number): InvoiceCycle {
  const closing = clampDay(year, month, card.closingDay);
  let dueYear = year;
  let dueMonth = month;
  let due = clampDay(dueYear, dueMonth, card.dueDay);
  if (due.getTime() <= closing.getTime()) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
    due = clampDay(dueYear, dueMonth, card.dueDay);
  }
  return {
    cardId: card.id,
    cycleYear: year,
    cycleMonth: month,
    closingDate: toISODate(closing),
    dueDate: toISODate(due),
    invoiceId: `${card.id}:${monthKey(year, month)}`,
  };
}

export function addCycles(card: Card, cycle: InvoiceCycle, n: number): InvoiceCycle {
  const total = cycle.cycleMonth - 1 + n;
  const year = cycle.cycleYear + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return buildCycle(card, year, month);
}

/** Divide o total em centavos distribuindo a sobra nas primeiras parcelas. */
export function splitInstallments(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const rest = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

export function addFrequency(date: Date, frequency: Frequency): Date {
  const d = new Date(date);
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "biweekly":
      d.setDate(d.getDate() + 14);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "bimonthly":
      d.setMonth(d.getMonth() + 2);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "semiannual":
      d.setMonth(d.getMonth() + 6);
      break;
    case "annual":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

export const frequencyLabels: Record<Frequency, string> = {
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  bimonthly: "Bimestral",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

export function inMonth(dateISO: string, year: number, month: number) {
  return dateISO.startsWith(monthKey(year, month));
}

/** Limite utilizado: parcelas/compras não canceladas de faturas ainda não pagas. */
export function cardUsedLimit(
  transactions: Transaction[],
  cardId: string,
  paidInvoiceIds: string[],
): number {
  return transactions
    .filter(
      (t) =>
        t.cardId === cardId &&
        t.type === "expense" &&
        t.status !== "cancelled" &&
        !paidInvoiceIds.includes(t.invoiceId ?? ""),
    )
    .reduce((sum, t) => sum + t.amount, 0);
}

export function formatDateBR(iso: string) {
  const d = parseISODate(iso);
  return d.toLocaleDateString("pt-BR");
}

export const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
