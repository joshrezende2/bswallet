import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addAudit, now, putRecord, uid } from "@/lib/db";
import {
  addCycles,
  addFrequency,
  frequencyLabels,
  invoiceCycleFor,
  splitInstallments,
  toISODate,
} from "@/lib/finance";
import { formatBRL, parseAmountToCents } from "@/lib/money";
import type { Frequency, PaymentMode, Scope, Transaction, TxType } from "@/lib/types";
import { useAccounts, useCards, useCategories, usePeople } from "@/hooks/useWallet";

const NONE = "__none__";

export function TransactionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: categories } = useCategories();
  const { data: cards } = useCards();
  const { data: accounts } = useAccounts();
  const { data: people } = usePeople();

  const [type, setType] = useState<TxType>("expense");
  const [mode, setMode] = useState<PaymentMode>("single");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [categoryId, setCategoryId] = useState("");
  const [personId, setPersonId] = useState(NONE);
  const [accountId, setAccountId] = useState(NONE);
  const [cardId, setCardId] = useState(NONE);
  const [installments, setInstallments] = useState("2");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [scope, setScope] = useState<Scope>("shared");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const availableCategories = useMemo(
    () => categories.filter((c) => c.active && (c.type === type || c.type === "both")),
    [categories, type],
  );
  const activeCards = useMemo(() => cards.filter((c) => c.active), [cards]);

  useEffect(() => {
    if (!open) return;
    setType("expense");
    setMode("single");
    setName("");
    setAmount("");
    setDate(toISODate(new Date()));
    setCategoryId("");
    setPersonId(NONE);
    setAccountId(NONE);
    setCardId(NONE);
    setInstallments("2");
    setFrequency("monthly");
    setNotes("");
  }, [open]);

  const cents = parseAmountToCents(amount);
  const installmentCount = Math.max(2, Number(installments) || 2);
  const preview =
    mode === "installment" && cents > 0
      ? splitInstallments(cents, installmentCount)
      : null;

  async function handleSave() {
    if (!name.trim()) { toast.error("Informe o nome do lançamento."); return; }
    if (cents <= 0) { toast.error("O valor deve ser maior que zero."); return; }
    if (!categoryId) { toast.error("Selecione uma categoria."); return; }
    if (mode === "installment" && cardId === NONE) { toast.error("Compras parceladas exigem um cartão."); return; }

    setSaving(true);
    try {
      const ts = now();
      const card = cards.find((c) => c.id === cardId);
      const common = {
        scope,
        type,
        name: name.trim(),
        categoryId,
        personId: personId === NONE ? undefined : personId,
        accountId: accountId === NONE ? undefined : accountId,
        cardId: cardId === NONE ? undefined : cardId,
        notes: notes.trim() || undefined,
        createdAt: ts,
        updatedAt: ts,
      };

      if (mode === "installment" && card) {
        const groupId = uid();
        const parts = splitInstallments(cents, installmentCount);
        const firstCycle = invoiceCycleFor(card, date);
        for (let i = 0; i < parts.length; i++) {
          const cycle = i === 0 ? firstCycle : addCycles(card, firstCycle, i);
          const tx: Transaction = {
            ...common,
            id: uid(),
            status: "pending",
            amount: parts[i] ?? 0,
            transactionDate: i === 0 ? date : cycle.dueDate,
            competenceDate: cycle.dueDate,
            paymentMode: "installment",
            installmentGroupId: groupId,
            installmentNumber: i + 1,
            installmentTotal: parts.length,
            invoiceId: cycle.invoiceId,
          };
          await putRecord("transactions", tx);
        }
        await addAudit({
          entityType: "transactions",
          entityId: groupId,
          action: "create",
          summary: `Compra parcelada ${name} em ${parts.length}x criada`,
        });
        toast.success(`${parts.length} parcelas criadas na fatura do cartão.`);
      } else if (mode === "recurring") {
        const recurrenceId = uid();
        const next = addFrequency(new Date(date), frequency);
        await putRecord("recurrences", {
          id: recurrenceId,
          type,
          name: name.trim(),
          amount: cents,
          categoryId,
          personId: personId === NONE ? undefined : personId,
          accountId: accountId === NONE ? undefined : accountId,
          cardId: cardId === NONE ? undefined : cardId,
          frequency,
          startDate: date,
          nextOccurrenceDate: toISODate(next),
          autoConfirm: false,
          scope,
          active: true,
          createdAt: ts,
          updatedAt: ts,
        });
        const tx: Transaction = {
          ...common,
          id: uid(),
          status: "pending",
          amount: cents,
          transactionDate: date,
          paymentMode: "recurring",
          recurrenceId,
          invoiceId: card ? invoiceCycleFor(card, date).invoiceId : undefined,
        };
        await putRecord("transactions", tx);
        toast.success("Recorrência criada com a primeira ocorrência prevista.");
      } else {
        const tx: Transaction = {
          ...common,
          id: uid(),
          status: date <= toISODate(new Date()) ? "confirmed" : "pending",
          amount: cents,
          transactionDate: date,
          paymentMode: "single",
          invoiceId: card ? invoiceCycleFor(card, date).invoiceId : undefined,
        };
        await putRecord("transactions", tx);
        await addAudit({
          entityType: "transactions",
          entityId: tx.id,
          action: "create",
          summary: `${type === "expense" ? "Despesa" : "Receita"} ${tx.name} criada`,
        });
        toast.success("Lançamento salvo neste aparelho.");
      }
      await qc.invalidateQueries();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo lançamento</DialogTitle>
          <DialogDescription>
            Salvo imediatamente no aparelho, mesmo sem internet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={type} onValueChange={(v) => setType(v as TxType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="expense">Despesa</TabsTrigger>
              <TabsTrigger value="income">Recebimento</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-2">
            <Label htmlFor="tx-name">Nome</Label>
            <Input
              id="tx-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Mercado do mês"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tx-amount">Valor (R$)</Label>
              <Input
                id="tx-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tx-date">Data</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Forma</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="single">Único</TabsTrigger>
                <TabsTrigger value="installment">Parcelado</TabsTrigger>
                <TabsTrigger value="recurring">Recorrente</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {mode === "installment" ? (
            <div className="grid gap-2">
              <Label htmlFor="tx-inst">Número de parcelas</Label>
              <Input
                id="tx-inst"
                type="number"
                min={2}
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
              {preview ? (
                <p className="text-xs text-muted-foreground">
                  {installmentCount}x de {formatBRL(preview[0] ?? 0)} — total{" "}
                  {formatBRL(cents)}
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === "recurring" ? (
            <div className="grid gap-2">
              <Label>Frequência</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(frequencyLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Pessoa</Label>
              <Select value={personId} onValueChange={setPersonId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem pessoa</SelectItem>
                  {people
                    .filter((p) => p.active)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Conta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem conta</SelectItem>
                  {accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Cartão</Label>
            <Select value={cardId} onValueChange={setCardId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem cartão</SelectItem>
                {activeCards.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} •••• {c.last4Digits}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Escopo</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">Compartilhado com a família</SelectItem>
                <SelectItem value="personal">Pessoal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tx-notes">Observações</Label>
            <Textarea
              id="tx-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            Salvar lançamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
