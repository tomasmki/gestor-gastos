import { daysBetween } from "./dates";
import type { DB } from "./db";
import { getAllTransactions, type Tx } from "./transactions";

/**
 * Un mismo gasto puede llegar por más de una fuente. Para no contarlo dos veces, el
 * movimiento "cubierto" se vincula (linked_to) al que tiene la información más precisa,
 * y solo cuentan los movimientos sin vínculo:
 *
 *  1. Pagaste en Mercado Pago con la tarjeta Santander → llega el aviso de Santander
 *     ("MERPAGO*...") y el mail de Mercado Pago. Se vincula Santander → Mercado Pago.
 *  2. Pagaste vos (tarjeta o MP) y lo cargaste en Splitwise → el consumo real es tu parte.
 *     Se vincula el pago → el gasto de Splitwise, que cuenta solo tu parte (owed_share).
 *
 * Las cadenas funcionan solas: Santander → MP → Splitwise deja contando solo a Splitwise.
 */

export interface Link {
  from: string;
  to: string;
}

const MP_ON_CARD = /MERPAGO|MERCADO ?PAGO|MPAGO/i;
const MP_MAX_DAYS = 3;
const SPLITWISE_MAX_DAYS = 5;

export function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(100, Math.abs(b) * 0.01);
}

export function findLinks(txs: Tx[]): Link[] {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const links: Link[] = [];
  const taken = new Set(sorted.flatMap((t) => (t.linkedTo ? [t.linkedTo] : [])));
  const linkedFrom = new Set<string>();
  const isFree = (t: Tx) => !t.linkedTo && !t.linkLocked && !t.ignored && !linkedFrom.has(t.id);

  function pick(from: Tx, candidates: Tx[], amountOf: (c: Tx) => number | null, maxDays: number) {
    let best: Tx | undefined;
    let bestScore = Infinity;
    for (const c of candidates) {
      const amount = amountOf(c);
      if (taken.has(c.id) || c.currency !== from.currency || amount == null || amount <= 0) continue;
      if (!amountsMatch(from.amountCents, amount)) continue;
      const days = daysBetween(from.date, c.date);
      if (days > maxDays) continue;
      const score = days + Math.abs(from.amountCents - amount) / amount;
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (best) {
      links.push({ from: from.id, to: best.id });
      taken.add(best.id);
      linkedFrom.add(from.id);
    }
  }

  const mercadopago = sorted.filter((t) => t.source === "mercadopago" && !t.ignored);
  for (const t of sorted) {
    if (t.source === "santander" && isFree(t) && t.amountCents > 0 && MP_ON_CARD.test(t.description)) {
      pick(t, mercadopago, (c) => c.amountCents, MP_MAX_DAYS);
    }
  }

  const splitwise = sorted.filter((t) => t.source === "splitwise" && !t.ignored);
  for (const t of sorted) {
    if (t.source !== "splitwise" && isFree(t) && t.amountCents > 0) {
      pick(t, splitwise, (c) => c.paidCents, SPLITWISE_MAX_DAYS);
    }
  }

  return links;
}

export function applyAutoLinks(db: DB): number {
  const links = findLinks(getAllTransactions(db));
  const update = db.prepare("UPDATE transactions SET linked_to = ?, updated_at = datetime('now') WHERE id = ?");
  db.transaction(() => {
    for (const link of links) update.run(link.to, link.from);
  })();
  return links.length;
}
