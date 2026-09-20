import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAccounts,
  useBudgets,
  useCategories,
  usePeople,
  useTrash,
} from "@/hooks/useWallet";
import {
  deleteRecord,
  exportBackup,
  importBackup,
  moveToTrash,
  now,
  putRecord,
  uid,
  type StoreName,
} from "@/lib/db";
import { addAudit } from "@/lib/db";
import { formatBRL, parseAmountToCents } from "@/lib/money";
import { formatDateBR, monthNames } from "@/lib/finance";
import type { Account, Budget, Category, Person, TrashItem } from "@/lib/types";

export const Route = createFileRoute("/ajustes")({
  head: () => ({
    meta: [
      { title: "Ajustes | BS Wallet" },
      {
        name: "description",
        content:
          "Cadastre categorias, pessoas, contas e orçamentos, restaure itens da lixeira e faça backup dos dados do BS Wallet.",
      },
      { property: "og:title", content: "Ajustes | BS Wallet" },
      {
        property: "og:description",
        content: "Categorias, pessoas, contas, orçamentos, lixeira e backup.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Ajustes,
});

function Ajustes() {
  return (
    <AppShell title="Ajustes" subtitle="Cadastros, lixeira e backup">
      <Tabs defaultValue="categorias">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="pessoas">Pessoas</TabsTrigger>
          <TabsTrigger value="contas">Contas</TabsTrigger>
          <TabsTrigger value="orcamentos">Orçamentos</TabsTrigger>
          <TabsTrigger value="lixeira">Lixeira</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
        </TabsList>
        <TabsContent value="categorias" className="mt-5">
          <Categorias />
        </TabsContent>
        <TabsContent value="pessoas" className="mt-5">
          <Pessoas />
        </TabsContent>
        <TabsContent value="contas" className="mt-5">
          <Contas />
        </TabsContent>
        <TabsContent value="orcamentos" className="mt-5">
          <Orcamentos />
        </TabsContent>
        <TabsContent value="lixeira" className="mt-5">
          <Lixeira />
        </TabsContent>
        <TabsContent value="backup" className="mt-5">
          <Backup />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function useCrud(store: StoreName) {
  const qc = useQueryClient();
  return {
    async save<T extends { id: string }>(record: T, label: string, isNew: boolean) {
      await putRecord(store, record);
      await addAudit({
        entityType: store,
        entityId: record.id,
        action: isNew ? "create" : "update",
        summary: `${label} ${isNew ? "criado" : "atualizado"}`,
      });
      await qc.invalidateQueries();
    },
    async remove(record: { id: string }, label: string) {
      await moveToTrash(store, record, label);
      await deleteRecord(store, record.id);
      await qc.invalidateQueries();
      toast.success(`${label} enviado para a lixeira.`);
    },
  };
}

function RowActions({ onDelete }: { onDelete: () => void }) {
  return (
    <Button size="icon" variant="ghost" aria-label="Excluir" onClick={onDelete}>
      <Trash2 className="size-4" />
    </Button>
  );
}

function Categorias() {
  const { data: categories } = useCategories();
  const crud = useCrud("categories");
  const [name, setName] = useState("");
  const [type, setType] = useState<Category["type"]>("expense");

  async function add() {
    if (!name.trim()) {
      toast.error("Informe o nome da categoria.");
      return;
    }
    const ts = now();
    await crud.save<Category>(
      {
        id: uid(),
        name: name.trim(),
        icon: "circle-dot",
        type,
        scope: "shared",
        active: true,
        createdAt: ts,
        updatedAt: ts,
      },
      "Categoria",
      true,
    );
    setName("");
    toast.success("Categoria criada.");
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_180px_auto]">
          <div className="grid gap-2">
            <Label htmlFor="cat-name">Nova categoria</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Pets"
            />
          </div>
          <div className="grid gap-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as Category["type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Recebimento</SelectItem>
                <SelectItem value="both">Ambos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={add} className="w-full sm:w-auto">
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {c.type === "expense" ? "Despesa" : c.type === "income" ? "Recebimento" : "Ambos"}
              </p>
            </div>
            <RowActions onDelete={() => crud.remove(c, c.name)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Pessoas() {
  const { data: people } = usePeople();
  const crud = useCrud("people");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");

  async function add() {
    if (!name.trim()) {
      toast.error("Informe o nome da pessoa.");
      return;
    }
    const ts = now();
    const cents = parseAmountToCents(limit);
    await crud.save<Person>(
      {
        id: uid(),
        name: name.trim(),
        scope: "shared",
        monthlySpendingLimit: cents > 0 ? cents : undefined,
        active: true,
        createdAt: ts,
        updatedAt: ts,
      },
      "Pessoa",
      true,
    );
    setName("");
    setLimit("");
    toast.success("Pessoa cadastrada.");
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_180px_auto]">
          <div className="grid gap-2">
            <Label htmlFor="person-name">Nova pessoa</Label>
            <Input
              id="person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Joseph"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="person-limit">Limite mensal (R$)</Label>
            <Input
              id="person-limit"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="opcional"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={add} className="w-full sm:w-auto">
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {people.length === 0 ? (
        <EmptyState
          title="Nenhuma pessoa cadastrada"
          description="Cadastre quem participa das finanças para acompanhar gastos por pessoa."
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {people.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.monthlySpendingLimit
                    ? `Limite mensal ${formatBRL(p.monthlySpendingLimit)}`
                    : "Sem limite definido"}
                </p>
              </div>
              <RowActions onDelete={() => crud.remove(p, p.name)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const accountTypes: Array<{ value: Account["type"]; label: string }> = [
  { value: "checking", label: "Conta corrente" },
  { value: "savings", label: "Poupança" },
  { value: "digital", label: "Conta digital" },
  { value: "cash", label: "Dinheiro" },
  { value: "other", label: "Outra" },
];

function Contas() {
  const { data: accounts } = useAccounts();
  const crud = useCrud("accounts");
  const [name, setName] = useState("");
  const [type, setType] = useState<Account["type"]>("checking");

  async function add() {
    if (!name.trim()) {
      toast.error("Informe o nome da conta.");
      return;
    }
    const ts = now();
    await crud.save<Account>(
      {
        id: uid(),
        name: name.trim(),
        type,
        scope: "shared",
        active: true,
        createdAt: ts,
        updatedAt: ts,
      },
      "Conta",
      true,
    );
    setName("");
    toast.success("Conta cadastrada.");
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_200px_auto]">
          <div className="grid gap-2">
            <Label htmlFor="acc-name">Nova conta</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Banco do Brasil"
            />
          </div>
          <div className="grid gap-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as Account["type"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={add} className="w-full sm:w-auto">
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                {accountTypes.find((t) => t.value === a.type)?.label}
              </p>
            </div>
            <RowActions onDelete={() => crud.remove(a, a.name)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Orcamentos() {
  const { data: budgets } = useBudgets();
  const { data: categories } = useCategories();
  const crud = useCrud("budgets");
  const today = new Date();
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));

  async function add() {
    const cents = parseAmountToCents(amount);
    if (!categoryId) {
      toast.error("Selecione uma categoria.");
      return;
    }
    if (cents <= 0) {
      toast.error("Informe um limite maior que zero.");
      return;
    }
    const ts = now();
    await crud.save<Budget>(
      {
        id: uid(),
        month: Number(month),
        year: Number(year),
        categoryId,
        limitAmount: cents,
        thresholds: [50, 80, 100],
        scope: "shared",
        active: true,
        createdAt: ts,
        updatedAt: ts,
      },
      "Orçamento",
      true,
    );
    setAmount("");
    toast.success("Orçamento criado.");
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Categoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {categories
                  .filter((c) => c.type !== "income")
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bud-amount">Limite (R$)</Label>
            <Input
              id="bud-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="grid gap-2">
            <Label>Mês</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthNames.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bud-year">Ano</Label>
            <Input
              id="bud-year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={add} className="w-full sm:w-auto">
              Adicionar orçamento
            </Button>
          </div>
        </CardContent>
      </Card>

      {budgets.length === 0 ? (
        <EmptyState
          title="Nenhum orçamento definido"
          description="Defina limites por categoria para acompanhar o consumo no Resumo."
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {budgets.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {categories.find((c) => c.id === b.categoryId)?.name ?? "Categoria"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {monthNames[b.month - 1]} de {b.year} · {formatBRL(b.limitAmount)}
                </p>
              </div>
              <RowActions onDelete={() => crud.remove(b, "Orçamento")} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Lixeira() {
  const qc = useQueryClient();
  const { data: trash } = useTrash();

  async function restore(item: TrashItem) {
    await putRecord(item.entityType as StoreName, item.snapshot as { id: string });
    await deleteRecord("trash", item.id);
    await addAudit({
      entityType: item.entityType,
      entityId: item.originalEntityId,
      action: "restore",
      summary: `${item.label} restaurado da lixeira`,
    });
    await qc.invalidateQueries();
    toast.success("Item restaurado.");
  }

  async function purge(item: TrashItem) {
    await deleteRecord("trash", item.id);
    await qc.invalidateQueries();
    toast.success("Item excluído definitivamente.");
  }

  if (trash.length === 0) {
    return (
      <EmptyState
        title="Lixeira vazia"
        description="Itens excluídos ficam aqui por 30 dias antes de sumirem de vez."
      />
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {trash.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground">
              Excluído em {formatDateBR(item.deletedAt.slice(0, 10))} · some em{" "}
              {formatDateBR(item.purgeAt.slice(0, 10))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary">{item.entityType}</Badge>
            <Button size="icon" variant="ghost" aria-label="Restaurar" onClick={() => restore(item)}>
              <RotateCcw className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Excluir de vez" onClick={() => purge(item)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Backup() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  async function download() {
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bs-wallet-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup gerado.");
  }

  async function onFile(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      await importBackup(parsed);
      await qc.invalidateQueries();
      toast.success("Backup restaurado neste aparelho.");
    } catch {
      toast.error("Arquivo inválido. Escolha um backup gerado pelo BS Wallet.");
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        <div>
          <p className="font-medium">Seus dados ficam neste aparelho</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Baixe uma cópia de segurança com frequência. Ao restaurar, os dados atuais deste
            aparelho são substituídos pelos do arquivo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={download}>
            <Download className="size-4" /> Baixar backup
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Restaurar backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
