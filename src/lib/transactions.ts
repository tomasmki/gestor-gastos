import { randomUUID } from "node:crypto";
import { addMonths } from "./dates";
import type { DB } from "./db";

export type Source = "santander" | "mercadopago" | "splitwise" | "csv" | "manual";

export const SOURCE_LABELS: Record<Source, string> = {
  santander: "Santander",
  mercadopago: "Mercado Pago",
  splitwise: "Splitwise",
  csv: "CSV",
  manual: "Manual",
};

export interface TxInput {
  id: string;
  source: Source;
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  paidCents?: number | null;
  totalCents?: number | null;
  category?: string | null;
  card?: string | null;
  installments?: string | null;
  /** Solo al insertar: hace que el movimiento arranque ignorado (p. ej. transferencias a personas). */
  ignoredByDefault?: boolean;
  raw?: unknown;
}

export interface Tx {
  id: string;
  source: Source;
  date: string;
  description: string;
  amountCents: number;
  currency: string;
  paidCents: number | null;
  totalCents: number | null;
  category: string | null;
  card: string | null;
  installments: string | null;
  linkedTo: string | null;
  linkLocked: boolean;
  ignored: boolean;
}

export interface TxWithLink extends Tx {
  linkedDescription: string | null;
  linkedSource: Source | null;
}

interface TxRow {
  id: string;
  source: Source;
  date: string;
  description: string;
  amount_cents: number;
  currency: string;
  paid_cents: number | null;
  total_cents: number | null;
  category: string | null;
  card: string | null;
  installments: string | null;
  linked_to: string | null;
  link_locked: number;
  ignored: number;
}

function fromRow(r: TxRow): Tx {
  return {
    id: r.id,
    source: r.source,
    date: r.date,
    description: r.description,
    amountCents: r.amount_cents,
    currency: r.currency,
    paidCents: r.paid_cents,
    totalCents: r.total_cents,
    category: r.category,
    card: r.card,
    installments: r.installments,
    linkedTo: r.linked_to,
    linkLocked: r.link_locked === 1,
    ignored: r.ignored === 1,
  };
}

/** Un movimiento suma al total si no está ignorado ni cubierto por otro (ver matching.ts). */
export function isCounted(tx: Pick<Tx, "ignored" | "linkedTo">): boolean {
  return !tx.ignored && !tx.linkedTo;
}

/**
 * Inserta o actualiza un movimiento. En una re-sincronización se pisan los datos de la fuente
 * pero se conservan las decisiones del usuario (categoría, ignorado, vínculos).
 */
export function upsertTransaction(db: DB, tx: TxInput): void {
  db.prepare(
    `INSERT INTO transactions
       (id, source, date, description, amount_cents, currency, paid_cents, total_cents,
        category, card, installments, ignored, raw)
     VALUES
       (@id, @source, @date, @description, @amountCents, @currency, @paidCents, @totalCents,
        @category, @card, @installments, @ignored, @raw)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date,
       description = excluded.description,
       amount_cents = excluded.amount_cents,
       currency = excluded.currency,
       paid_cents = excluded.paid_cents,
       total_cents = excluded.total_cents,
       category = COALESCE(transactions.category, excluded.category),
       card = excluded.card,
       installments = excluded.installments,
       raw = excluded.raw,
       updated_at = datetime('now')`,
  ).run({
    id: tx.id,
    source: tx.source,
    date: tx.date,
    description: tx.description,
    amountCents: tx.amountCents,
    currency: tx.currency,
    paidCents: tx.paidCents ?? null,
    totalCents: tx.totalCents ?? null,
    category: tx.category ?? null,
    card: tx.card ?? null,
    installments: tx.installments ?? null,
    ignored: tx.ignoredByDefault ? 1 : 0,
    raw: tx.raw === undefined ? null : JSON.stringify(tx.raw),
  });
}

export function deleteTransaction(db: DB, id: string): void {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
}

export function getAllTransactions(db: DB): Tx[] {
  return (db.prepare("SELECT * FROM transactions ORDER BY date, id").all() as TxRow[]).map(fromRow);
}

export function listMonth(db: DB, month: string): TxWithLink[] {
  const rows = db
    .prepare(
      `SELECT t.*, l.description AS linked_description, l.source AS linked_source
       FROM transactions t
       LEFT JOIN transactions l ON l.id = t.linked_to
       WHERE t.date >= ? AND t.date < ?
       ORDER BY t.date DESC, t.created_at DESC`,
    )
    .all(`${month}-01`, `${addMonths(month, 1)}-01`) as (TxRow & {
    linked_description: string | null;
    linked_source: Source | null;
  })[];
  return rows.map((r) => ({
    ...fromRow(r),
    linkedDescription: r.linked_description,
    linkedSource: r.linked_source,
  }));
}

export interface Summary {
  totals: { currency: string; cents: number }[];
  byCategory: { currency: string; category: string; cents: number }[];
  bySource: { currency: string; source: Source; cents: number }[];
}

export function summarize(txs: Tx[]): Summary {
  const totals = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const bySource = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const tx of txs) {
    if (!isCounted(tx) || tx.amountCents === 0) continue;
    add(totals, tx.currency, tx.amountCents);
    add(byCategory, `${tx.currency}|${tx.category ?? "Otros"}`, tx.amountCents);
    add(bySource, `${tx.currency}|${tx.source}`, tx.amountCents);
  }

  const split = (k: string) => k.split("|") as [string, string];
  const byCents = (a: { cents: number }, b: { cents: number }) => b.cents - a.cents;
  return {
    totals: [...totals].map(([currency, cents]) => ({ currency, cents })).sort(byCents),
    byCategory: [...byCategory]
      .map(([k, cents]) => ({ currency: split(k)[0], category: split(k)[1], cents }))
      .sort(byCents),
    bySource: [...bySource]
      .map(([k, cents]) => ({ currency: split(k)[0], source: split(k)[1] as Source, cents }))
      .sort(byCents),
  };
}

/** Total contado por mes y moneda desde `fromMonth` (inclusive). */
export function monthlyTotals(db: DB, fromMonth: string): { month: string; currency: string; cents: number }[] {
  return db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, currency, SUM(amount_cents) AS cents
       FROM transactions
       WHERE ignored = 0 AND linked_to IS NULL AND date >= ?
       GROUP BY month, currency
       ORDER BY month`,
    )
    .all(`${fromMonth}-01`) as { month: string; currency: string; cents: number }[];
}

export function setIgnored(db: DB, id: string, ignored: boolean): void {
  db.prepare("UPDATE transactions SET ignored = ?, updated_at = datetime('now') WHERE id = ?").run(
    ignored ? 1 : 0,
    id,
  );
}

export function setCategory(db: DB, id: string, category: string): void {
  db.prepare("UPDATE transactions SET category = ?, updated_at = datetime('now') WHERE id = ?").run(
    category,
    id,
  );
}

/** Deshace un vínculo automático y evita que se vuelva a crear. */
export function unlink(db: DB, id: string): void {
  db.prepare(
    "UPDATE transactions SET linked_to = NULL, link_locked = 1, updated_at = datetime('now') WHERE id = ?",
  ).run(id);
}

export function addManual(
  db: DB,
  input: { date: string; description: string; amountCents: number; currency: string; category: string },
): void {
  upsertTransaction(db, { id: `manual:${randomUUID()}`, source: "manual", ...input });
}
