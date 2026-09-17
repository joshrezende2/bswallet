import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addAudit,
  deleteRecord,
  listAll,
  moveToTrash,
  now,
  putRecord,
  uid,
  type StoreName,
} from "@/lib/db";
import type {
  Account,
  Budget,
  Card,
  Category,
  Person,
  Recurrence,
  Transaction,
  Transfer,
  TrashItem,
  AuditLog,
} from "@/lib/types";

const isBrowser = typeof window !== "undefined";

function useStore<T>(store: StoreName) {
  return useQuery({
    queryKey: [store],
    queryFn: () => listAll<T>(store),
    enabled: isBrowser,
    initialData: [] as T[],
  });
}

export const useTransactions = () => useStore<Transaction>("transactions");
export const useCards = () => useStore<Card>("cards");
export const useAccounts = () => useStore<Account>("accounts");
export const usePeople = () => useStore<Person>("people");
export const useCategories = () => useStore<Category>("categories");
export const useRecurrences = () => useStore<Recurrence>("recurrences");
export const useBudgets = () => useStore<Budget>("budgets");
export const useTransfers = () => useStore<Transfer>("transfers");
export const useTrash = () => useStore<TrashItem>("trash");
export const useAudit = () => useStore<AuditLog>("audit");

export function useSaveRecord<T extends { id?: string }>(store: StoreName, entityLabel: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: T) => {
      const ts = now();
      const record = {
        ...input,
        id: input.id ?? uid(),
        createdAt: (input as { createdAt?: string }).createdAt ?? ts,
        updatedAt: ts,
      } as T & { id: string };
      await putRecord(store, record);
      await addAudit({
        entityType: store,
        entityId: record.id,
        action: input.id ? "update" : "create",
        summary: `${entityLabel} ${input.id ? "atualizado" : "criado"}`,
      });
      return record;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [store] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useDeleteRecord(store: StoreName, labelOf: (item: never) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: { id: string }) => {
      await moveToTrash(store, item, labelOf(item as never));
      await deleteRecord(store, item.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [store] });
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useRestoreTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: TrashItem) => {
      await putRecord(item.entityType as StoreName, item.snapshot as { id: string });
      await deleteRecord("trash", item.id);
      await addAudit({
        entityType: item.entityType,
        entityId: item.originalEntityId,
        action: "restore",
        summary: `${item.label} restaurado da lixeira`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

export function usePurgeTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: TrashItem) => deleteRecord("trash", item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trash"] }),
  });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
