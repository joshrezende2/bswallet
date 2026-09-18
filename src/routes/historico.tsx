import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCategories, useTransactions } from "@/hooks/useWallet";
import { addAudit, deleteRecord, moveToTrash, now, putRecord } from "@/lib/db";
import { formatDateBR } from "@/lib/finance";
import { formatBRL } from "@/lib/money";
import type { Transaction, TxStatus } from "@/lib/types";

export const Route = createFileRoute("/historico")({
  head: () => ({
    meta: [
      { title: "Histórico | BS Wallet" },
      {
        name: "description",
        content:
          "Consulte todos os lançamentos registrados, filtre por tipo, situação e categoria no BS Wallet.",
      },
      { property: "og:title", content: "Histórico | BS Wallet" },
      {
        property: "og:description",
        content: "Todos os lançamentos da família, com busca e filtros.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Historico,
});

const statusLabels: Record<TxStatus, string> = {
  forecast: "Previsto",
  pending: "Pendente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
};

function Historico() {
  const qc = useQueryClient();
  const { data: transactions } = useTransactions();
  const { data: categories } = useCategories();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [categoryId, setCategoryId] = useState("all");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transactions
      .filter((t) => (type === "all" ? true : t.type === type))
      .filter((t) => (status === "all" ? true : t.status === status))
      .filter((t) => (categoryId === "all" ? true : t.categoryId === categoryId))
      .filter((t) => (term ? t.name.toLowerCase().includes(term) : true))
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  }, [transactions, type, status, categoryId, search]);

  async function setStatusOf(t: Transaction, next: TxStatus) {
    await putRecord("transactions", { ...t, status: next, updatedAt: now() });
    await addAudit({
      entityType: "transactions",
      entityId: t.id,
      action: "status_change",
      summary: `${t.name} marcado como ${statusLabels[next].toLowerCase()}`,
    });
    await qc.invalidateQueries();
  }

  async function remove(t: Transaction) {
    await moveToTrash("transactions", t, t.name);
    await deleteRecord("transactions", t.id);
    await qc.invalidateQueries();
    toast.success("Lançamento enviado para a lixeira.");
  }

  return (
    <AppShell title="Histórico" subtitle={`${filtered.length} lançamento(s)`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Buscar por nome"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="expense">Despesas</SelectItem>
            <SelectItem value="income">Recebimentos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {Object.entries(statusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6">
        {filtered.length === 0 ? (
          <EmptyState
            title="Nada encontrado"
            description="Ajuste os filtros ou registre um novo lançamento."
          />
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {filtered.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.name}
                    {t.installmentTotal ? ` (${t.installmentNumber}/${t.installmentTotal})` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateBR(t.transactionDate)} ·{" "}
                    {categories.find((c) => c.id === t.categoryId)?.name ?? "Sem categoria"} ·{" "}
                    {statusLabels[t.status]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={
                      t.type === "income"
                        ? "text-sm font-semibold text-success"
                        : "text-sm font-semibold text-destructive"
                    }
                  >
                    {t.type === "income" ? "+" : "−"} {formatBRL(t.amount)}
                  </span>
                  {t.status !== "confirmed" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Confirmar"
                      onClick={() => setStatusOf(t, "confirmed")}
                    >
                      <Check className="size-4" />
                    </Button>
                  ) : null}
                  {t.status !== "cancelled" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Cancelar"
                      onClick={() => setStatusOf(t, "cancelled")}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Excluir"
                    onClick={() => remove(t)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
