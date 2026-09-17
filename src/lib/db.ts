import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  Account,
  AuditLog,
  Budget,
  Card,
  Category,
  Person,
  Recurrence,
  Transaction,
  Transfer,
  TrashItem,
} from "./types";

interface BSWalletDB extends DBSchema {
  transactions: { key: string; value: Transaction };
  recurrences: { key: string; value: Recurrence };
  cards: { key: string; value: Card };
  accounts: { key: string; value: Account };
  people: { key: string; value: Person };
  categories: { key: string; value: Category };
  budgets: { key: string; value: Budget };
  transfers: { key: string; value: Transfer };
  audit: { key: string; value: AuditLog };
  trash: { key: string; value: TrashItem };
  meta: { key: string; value: { id: string; value: unknown } };
}

export type StoreName =
  | "transactions"
  | "recurrences"
  | "cards"
  | "accounts"
  | "people"
  | "categories"
  | "budgets"
  | "transfers"
  | "audit"
  | "trash"
  | "meta";

const STORES: StoreName[] = [
  "transactions",
  "recurrences",
  "cards",
  "accounts",
  "people",
  "categories",
  "budgets",
  "transfers",
  "audit",
  "trash",
  "meta",
];

let dbPromise: Promise<IDBPDatabase<BSWalletDB>> | null = null;

export function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB indisponível no servidor");
  }
  if (!dbPromise) {
    dbPromise = openDB<BSWalletDB>("bs-wallet", 1, {
      upgrade(db) {
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: "id" });
          }
        }
      },
    }).then(async (db) => {
      await seed(db);
      await purgeExpiredTrash(db);
      return db;
    });
  }
  return dbPromise;
}

export function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function now() {
  return new Date().toISOString();
}

const defaultCategories: Array<Pick<Category, "name" | "icon" | "type">> = [
  { name: "Alimentação", icon: "utensils", type: "expense" },
  { name: "Mercado", icon: "shopping-cart", type: "expense" },
  { name: "Moradia", icon: "home", type: "expense" },
  { name: "Transporte", icon: "car", type: "expense" },
  { name: "Saúde", icon: "heart-pulse", type: "expense" },
  { name: "Educação", icon: "graduation-cap", type: "expense" },
  { name: "Lazer", icon: "party-popper", type: "expense" },
  { name: "Assinaturas", icon: "repeat", type: "expense" },
  { name: "Salário", icon: "wallet", type: "income" },
  { name: "Freelance", icon: "briefcase", type: "income" },
  { name: "Outros", icon: "circle-dot", type: "both" },
];

async function seed(db: IDBPDatabase<BSWalletDB>) {
  const seeded = await db.get("meta", "seeded");
  if (seeded) return;
  const ts = now();
  const tx = db.transaction(["categories", "accounts", "meta"], "readwrite");
  for (const c of defaultCategories) {
    await tx.objectStore("categories").put({
      id: uid(),
      ...c,
      scope: "shared",
      active: true,
      createdAt: ts,
      updatedAt: ts,
    });
  }
  await tx.objectStore("accounts").put({
    id: uid(),
    name: "Carteira",
    type: "cash",
    scope: "shared",
    active: true,
    createdAt: ts,
    updatedAt: ts,
  });
  await tx.objectStore("meta").put({ id: "seeded", value: true });
  await tx.done;
}

async function purgeExpiredTrash(db: IDBPDatabase<BSWalletDB>) {
  const items = await db.getAll("trash");
  const nowISO = now();
  for (const item of items) {
    if (item.purgeAt <= nowISO) await db.delete("trash", item.id);
  }
}

export async function listAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDB();
  return (await db.getAll(store)) as T[];
}

export async function putRecord<T extends { id: string }>(store: StoreName, value: T) {
  const db = await getDB();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.put(store as any, value as any);
  return value;
}

export async function getRecord<T>(store: StoreName, id: string) {
  const db = await getDB();
  return (await db.get(store, id)) as T | undefined;
}

export async function deleteRecord(store: StoreName, id: string) {
  const db = await getDB();
  await db.delete(store, id);
}

export async function addAudit(entry: Omit<AuditLog, "id" | "timestamp">) {
  await putRecord<AuditLog>("audit", { ...entry, id: uid(), timestamp: now() });
}

export async function moveToTrash(
  entityType: string,
  entity: { id: string },
  label: string,
) {
  const deletedAt = new Date();
  const purge = new Date(deletedAt);
  purge.setDate(purge.getDate() + 30);
  await putRecord<TrashItem>("trash", {
    id: uid(),
    entityType,
    originalEntityId: entity.id,
    snapshot: entity,
    label,
    deletedAt: deletedAt.toISOString(),
    purgeAt: purge.toISOString(),
  });
  await addAudit({
    entityType,
    entityId: entity.id,
    action: "delete",
    summary: `${label} enviado para a lixeira`,
  });
}

export async function exportBackup() {
  const db = await getDB();
  const data: Record<string, unknown> = { exportedAt: now(), version: 1 };
  for (const store of STORES) {
    if (store === "meta") continue;
    data[store] = await db.getAll(store);
  }
  return data;
}

export async function importBackup(data: Record<string, unknown>) {
  const db = await getDB();
  for (const store of STORES) {
    if (store === "meta") continue;
    const rows = data[store];
    if (!Array.isArray(rows)) continue;
    const tx = db.transaction(store, "readwrite");
    await tx.store.clear();
    for (const row of rows) await tx.store.put(row);
    await tx.done;
  }
}
