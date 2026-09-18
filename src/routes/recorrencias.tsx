import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCategories, useRecurrences } from "@/hooks/useWallet";
import { addAudit, moveToTrash, deleteRecord, now, putRecord, uid } from "@/lib/db";
import { addFrequency, formatDateBR, frequencyLabels, parseISODate, toISODate } from "@/lib/finance";
import { formatBRL } from "@/lib/money";
import type { Recurrence, Transaction } from "@/lib/types";

export const Route = createFileRoute("/recorrencias")({
  head: () => ({
    meta: [
      { title: "Recorrências | BS Wallet" },
      {
        name: "description",
        content:
          "Gerencie assinaturas, contas fixas e recebimentos recorrentes da família no BS Wallet.",
      },
      { property: "og:title", content: "Recorrências | BS Wallet" },
      {
        property: "og:description",
        content: "Assinaturas e contas fixas com próxima ocorrência sempre à vista.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Recorrencias,
});

function Recorrencias() {
  const qc = useQueryClient();
  const { data: recurrences } = useRecurrences();
  const { data: categories } = useCategories();

  const sorted = [...recurrences].sort((a, b) =>
    a.nextOccurrenceDate.localeCompare(b.nextOccurrenceDate),
  );

  async function toggleActive(r: Recurrence) {
    await putRecord("recurrences", { ...r, active: !r.active, updatedAt: now() });
    await addAudit({
      entityType: "recurrences",
      entityId: r.id,
      action: "status_change",
      summary: `${r.name} ${r.active ? "pausada" : "reativada"}`,
    });
    await qc.invalidateQueries();
    toast.success(r.active ? "Recorrência pausada." : "Recorrência reativada.");
  }

  async function generateNext(r: Recurrence) {
    const ts = now();
    const tx: Transaction = {
      id: uid(),
      scope: r.scope,
      type: r.type,
      status: r.autoConfirm ? "confirmed" : "pending",
      name: r.name,
      amount: r.amount,
      transactionDate: r.nextOccurrenceDate,
      categoryId: r.categoryId,
      personId: r.personId,
      accountId: r.accountId,
      cardId: r.cardId,
      paymentMode: "recurring",
      recurrenceId: r.id,
      createdAt: ts,
      updatedAt: ts,
    };
    await putRecord("transactions", tx);
    const next = addFrequency(parseISODate(r.nextOccurrenceDate), r.frequency);
    await putRecord("recurrences", {
      ...r,
      nextOccurrenceDate: toISODate(next),
      updatedAt: ts,
    });
    await addAudit({
      entityType: "transactions",
      entityId: tx.id,
      action: "create",
      summary: `Ocorrência de ${r.name} lançada`,
    });
    await qc.invalidateQueries();
    toast.success("Ocorrência lançada e próxima data atualizada.");
  }

  async function remove(r: Recurrence) {
    await moveToTrash("recurrences", r, r.name);
    await deleteRecord("recurrences", r.id);
    await qc.invalidateQueries();
    toast.success("Recorrência enviada para a lixeira.");
  }

  return (
    <AppShell title="Recorrências" subtitle="Assinaturas, contas fixas e recebimentos">
      {sorted.length === 0 ? (
        <EmptyState
          title="Nenhuma recorrência cadastrada"
          description="Crie um lançamento na forma Recorrente para acompanhar contas fixas e assinaturas aqui."
          action={
            <Button variant="outline" disabled>
              <Plus className="size-4" /> Use o botão Adicionar lançamento
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {sorted.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{r.name}</p>
                    <Badge variant={r.active ? "default" : "secondary"}>
                      {r.active ? frequencyLabels[r.frequency] : "Pausada"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Próxima em {formatDateBR(r.nextOccurrenceDate)} ·{" "}
                    {categories.find((c) => c.id === r.categoryId)?.name ?? "Sem categoria"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      r.type === "income"
                        ? "text-sm font-semibold text-success"
                        : "text-sm font-semibold text-destructive"
                    }
                  >
                    {formatBRL(r.amount)}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => generateNext(r)}>
                    Lançar
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={r.active ? "Pausar" : "Reativar"}
                    onClick={() => toggleActive(r)}
                  >
                    {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Excluir"
                    onClick={() => remove(r)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
