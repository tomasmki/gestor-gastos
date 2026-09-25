import { categorizeSplitwise } from "./categories";
import { syncDays } from "./config";
import { toLocalDate } from "./dates";
import { getSetting, setSetting, type DB } from "./db";
import { decimalToCents } from "./money";
import { deleteTransaction, upsertTransaction, type TxInput } from "./transactions";

// API de Splitwise v3: https://dev.splitwise.com
// Para uso personal alcanza con la "API key" que da Splitwise al registrar una app.

const BASE_URL = "https://secure.splitwise.com/api/v3.0";
const PAGE_SIZE = 100;

export interface SplitwiseExpense {
  id: number;
  description: string;
  cost: string;
  currency_code: string;
  date: string;
  payment: boolean;
  deleted_at: string | null;
  group_id: number | null;
  category?: { id: number; name: string };
  users: { user_id: number; paid_share: string; owed_share: string }[];
}

interface SplitwiseUser {
  id: number;
  first_name: string;
  last_name: string | null;
}

async function swFetch<T>(apiKey: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (res.status === 401) throw new Error("Splitwise rechazó la API key (401). Revisá SPLITWISE_API_KEY.");
  if (!res.ok) throw new Error(`Splitwise API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/**
 * Convierte un gasto de Splitwise en un movimiento propio. Lo que cuenta como gasto es tu
 * parte (owed_share), no lo que pagaste: si pagaste la cena de 4 con la tarjeta, el aviso de
 * Santander se vincula a este gasto y solo suma tu cuarto. Si no participás, devuelve null.
 */
export function mapExpense(expense: SplitwiseExpense, myUserId: number): TxInput | null {
  if (expense.payment || expense.deleted_at) return null;
  const me = expense.users.find((u) => u.user_id === myUserId);
  if (!me) return null;

  const owed = decimalToCents(me.owed_share);
  const paid = decimalToCents(me.paid_share);
  if (owed === 0 && paid === 0) return null;

  const description = expense.description.trim();
  return {
    id: `splitwise:${expense.id}`,
    source: "splitwise",
    date: toLocalDate(new Date(expense.date)),
    description,
    amountCents: owed,
    currency: expense.currency_code,
    paidCents: paid,
    totalCents: decimalToCents(expense.cost),
    category: categorizeSplitwise(expense.category?.name, description),
    raw: { id: expense.id, group_id: expense.group_id },
  };
}

export interface SplitwiseSyncResult {
  user: string;
  upserted: number;
  removed: number;
}

export async function syncSplitwise(db: DB, apiKey: string): Promise<SplitwiseSyncResult> {
  const startedAt = new Date().toISOString();
  const { user } = await swFetch<{ user: SplitwiseUser }>(apiKey, "/get_current_user");

  // Primera vez: los últimos SYNC_DAYS días. Después: todo lo creado/editado/borrado desde la última.
  const lastSync = getSetting<string>(db, "splitwise_last_sync");
  const filter: Record<string, string> = lastSync
    ? { updated_after: new Date(Date.parse(lastSync) - 86_400_000).toISOString() }
    : { dated_after: new Date(Date.now() - syncDays() * 86_400_000).toISOString() };

  const expenses: SplitwiseExpense[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await swFetch<{ expenses: SplitwiseExpense[] }>(apiKey, "/get_expenses", {
      ...filter,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    expenses.push(...page.expenses);
    if (page.expenses.length < PAGE_SIZE) break;
  }

  let upserted = 0;
  let removed = 0;
  db.transaction(() => {
    for (const expense of expenses) {
      const tx = mapExpense(expense, user.id);
      if (tx) {
        upsertTransaction(db, tx);
        upserted++;
      } else {
        // Borrado, pago entre amigos, o ya no participás: si lo teníamos, se saca.
        deleteTransaction(db, `splitwise:${expense.id}`);
        removed++;
      }
    }
  })();

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  setSetting(db, "splitwise_last_sync", startedAt);
  setSetting(db, "splitwise_user", name);
  return { user: name, upserted, removed };
}
