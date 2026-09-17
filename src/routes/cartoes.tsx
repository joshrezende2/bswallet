import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { buildCycle, formatDateBR, invoiceCycleFor } from "@/lib/finance";
import { formatBRL, parseAmountToCents } from "@/lib/money";
import type { Card as CardType } from "@/lib/types";
import { useCards, useDeleteRecord, useSaveRecord, useTransactions } from "@/hooks/useWallet";

export const Route = createFileRoute("/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões e faturas | BS Wallet" },
      {
        name: "description",
        content:
          "Cadastre cartões, acompanhe limite utilizado e veja a fatura atual e as próximas faturas com parcelas.",
      },
      { property: "og:title", content: "Cartões e faturas | BS Wallet" },
      {
        property: "og:description",
        content: "Limite disponível, fatura atual e parcelas futuras de cada cartão.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Cartoes,
});

function Cartoes() {
  const { data: cards } = useCards();
  const { data: transactions } = useTransactions();
  const save = useSaveRecord<Partial<CardType>>("cards", "Cartão");
  const remove = useDeleteRecord("cards", (c: CardType) => `Cartão ${c.name}`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    bank: "",
    brand: "",
    last4Digits: "",
    totalLimit: "",
    closingDay: "5",
    dueDay: "12",
  });

  const handleSave = () => {
    if (!form.name.trim() || !form.bank.trim()) {
      toast.error("Informe ao menos nome e banco do cartão.");
      return;
    }
    save.mutate(
      {
        name: form.name.trim(),
        bank: form.bank.trim(),
        brand: form.brand.trim(),
        last4Digits: form.last4Digits.replace(/\D/g, "").slice(-4),
        totalLimit: parseAmountToCents(form.totalLimit),
        closingDay: Math.min(31, Math.max(1, Number(form.closingDay) || 1)),
        dueDay: Math.min(31, Math.max(1, Number(form.dueDay) || 1)),
        scope: "shared",
        active: true,
      },
      {
        onSuccess: () => {
          toast.success("Cartão salvo.");
          setOpen(false);
          setForm({
            name: "",
            bank: "",
            brand: "",
            last4Digits: "",
            totalLimit: "",
            closingDay: "5",
            dueDay: "12",
          });
        },
      },
    );
  };

  return (
    <AppShell
      title="Cartões"
      subtitle="Limites, faturas e parcelas"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> Cartão
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Novo cartão</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="Nome" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Banco" value={form.bank} onChange={(v) => setForm({ ...form, bank: v })} />
              <Field
                label="Bandeira"
                value={form.brand}
                onChange={(v) => setForm({ ...form, brand: v })}
              />
              <Field
                label="Últimos 4 dígitos"
                value={form.last4Digits}
                onChange={(v) => setForm({ ...form, last4Digits: v })}
              />
              <Field
                label="Limite total (R$)"
                value={form.totalLimit}
                onChange={(v) => setForm({ ...form, totalLimit: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Dia de fechamento"
                  value={form.closingDay}
                  onChange={(v) => setForm({ ...form, closingDay: v })}
                />
                <Field
                  label="Dia de vencimento"
                  value={form.dueDay}
                  onChange={(v) => setForm({ ...form, dueDay: v })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Por segurança, o BS Wallet nunca guarda o número completo, o CVV ou a senha do
                cartão.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={handleSave}>Salvar cartão</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {cards.length === 0 ? (
        <EmptyState
          title="Nenhum cartão cadastrado"
          description="Cadastre um cartão para acompanhar faturas, parcelas e limite disponível."
        />
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <CardPanel
              key={card.id}
              card={card}
              transactions={transactions}
              onDelete={() => remove.mutate(card)}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function CardPanel({
  card,
  transactions,
  onDelete,
}: {
  card: CardType;
  transactions: ReturnType<typeof useTransactions>["data"];
  onDelete: () => void;
}) {
  const cardTx = useMemo(
    () => transactions.filter((t) => t.cardId === card.id && t.status !== "cancelled"),
    [transactions, card.id],
  );
  const used = cardTx.reduce((s, t) => s + t.amount, 0);
  const available = Math.max(0, card.totalLimit - used);
  const pct = card.totalLimit ? Math.round((used / card.totalLimit) * 100) : 0;

  const currentCycle = invoiceCycleFor(card, new Date().toISOString().slice(0, 10));
  const cycles = [0, 1, 2].map((i) => {
    let month = currentCycle.cycleMonth + i;
    let year = currentCycle.cycleYear;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    return buildCycle(card, year, month);
  });

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{card.name}</p>
            <p className="text-xs text-muted-foreground">
              {card.bank} · {card.brand || "Sem bandeira"} · •••• {card.last4Digits || "0000"}
            </p>
            <p className="text-xs text-muted-foreground">
              Fecha dia {card.closingDay} · vence dia {card.dueDay}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Excluir cartão">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>

        <div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Utilizado {formatBRL(used)}</span>
            <span>Disponível {formatBRL(available)}</span>
          </div>
          <Progress value={Math.min(pct, 100)} className="mt-2" />
          <p className="mt-1 text-xs text-muted-foreground">
            {pct}% do limite de {formatBRL(card.totalLimit)}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {cycles.map((cycle, i) => {
            const total = cardTx
              .filter((t) => t.invoiceId === cycle.invoiceId)
              .reduce((s, t) => s + t.amount, 0);
            return (
              <div key={cycle.invoiceId} className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {i === 0 ? "Fatura atual" : `Fatura +${i}`}
                </p>
                <p className="mt-1 text-lg font-semibold">{formatBRL(total)}</p>
                <p className="text-xs text-muted-foreground">
                  Fecha {formatDateBR(cycle.closingDate)} · vence {formatDateBR(cycle.dueDate)}
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-1">
          {cardTx
            .filter((t) => t.invoiceId === currentCycle.invoiceId)
            .slice(0, 6)
            .map((t) => (
              <div key={t.id} className="flex justify-between text-sm">
                <span className="truncate">
                  {t.name}
                  {t.installmentTotal ? ` (${t.installmentNumber}/${t.installmentTotal})` : ""}
                </span>
                <span className="text-muted-foreground">{formatBRL(t.amount)}</span>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
