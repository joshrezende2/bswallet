import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatBRL } from "@/lib/money";
import { formatDateBR, inMonth, monthNames } from "@/lib/finance";
import { useBudgets, useCategories, useTransactions } from "@/hooks/useWallet";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Resumo mensal | BS Wallet" },
      {
        name: "description",
        content:
          "Acompanhe receitas, despesas e saldo do mês da família no BS Wallet, seu controle financeiro offline-first.",
      },
      { property: "og:title", content: "Resumo mensal | BS Wallet" },
      {
        property: "og:description",
        content: "Receitas, despesas, saldo e orçamentos do mês em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Resumo,
});

function Resumo() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const { data: transactions } = useTransactions();
  const { data: budgets } = useBudgets();
  const { data: categories } = useCategories();

  const monthTx = useMemo(
    () =>
      transactions
        .filter((t) => t.status !== "cancelled" && inMonth(t.transactionDate, year, month))
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)),
    [transactions, year, month],
  );

  const income = monthTx
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const expense = monthTx
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  const step = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (m < 1) {
      m = 12;
      y--;
    }
    setMonth(m);
    setYear(y);
  };

  const monthBudgets = budgets.filter((b) => b.active && b.month === month && b.year === year);

  return (
    <AppShell
      title="Resumo"
      subtitle={`${monthNames[month - 1]} de ${year}`}
      action={
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Mês anterior">
            <ArrowLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Próximo mês">
            <ArrowRight className="size-4" />
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Recebimentos" value={income} icon={TrendingUp} tone="income" />
        <SummaryCard label="Despesas" value={expense} icon={TrendingDown} tone="expense" />
        <SummaryCard label="Saldo do período" value={balance} icon={Wallet} tone="balance" />
      </div>

      {monthBudgets.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Orçamentos do mês
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {monthBudgets.map((b) => {
              const spent = monthTx
                .filter((t) => t.type === "expense" && t.categoryId === b.categoryId)
                .reduce((s, t) => s + t.amount, 0);
              const pct = b.limitAmount ? Math.round((spent / b.limitAmount) * 100) : 0;
              const category = categories.find((c) => c.id === b.categoryId);
              return (
                <Card key={b.id}>
                  <CardContent className="pt-5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{category?.name ?? "Categoria"}</span>
                      <span className="text-muted-foreground">
                        {formatBRL(spent)} / {formatBRL(b.limitAmount)}
                      </span>
                    </div>
                    <Progress value={Math.min(pct, 100)} className="mt-3" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {pct}% consumido
                      {pct >= 100
                        ? " — limite estourado"
                        : pct >= 90
                          ? " — atenção, perto do limite"
                          : ""}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Lançamentos do mês
        </h2>
        {monthTx.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento neste mês"
            description="Use o botão Adicionar lançamento para registrar sua primeira despesa ou recebimento."
          />
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {monthTx.slice(0, 30).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.name}
                    {t.installmentTotal
                      ? ` (${t.installmentNumber}/${t.installmentTotal})`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateBR(t.transactionDate)} ·{" "}
                    {categories.find((c) => c.id === t.categoryId)?.name ?? "Sem categoria"} ·{" "}
                    {t.status === "confirmed" ? "Confirmado" : "Previsto"}
                  </p>
                </div>
                <span
                  className={
                    t.type === "income"
                      ? "shrink-0 text-sm font-semibold text-success"
                      : "shrink-0 text-sm font-semibold text-destructive"
                  }
                >
                  {t.type === "income" ? "+" : "−"} {formatBRL(t.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: "income" | "expense" | "balance";
}) {
  const color =
    tone === "income"
      ? "text-success"
      : tone === "expense"
        ? "text-destructive"
        : value >= 0
          ? "text-foreground"
          : "text-destructive";
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        <p className={`mt-2 text-2xl font-semibold tracking-tight ${color}`}>
          {formatBRL(value)}
        </p>
      </CardContent>
    </Card>
  );
}
