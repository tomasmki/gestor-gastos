import type { Tx } from "./transactions";

// Compras en cuotas: cada mes suma solo la cuota que le toca, empezando por el mes de la compra
// (cuota 1) y siguiendo mes a mes. El importe del aviso se toma como el total de la compra; los
// centavos que no dividen exacto van en la primera cuota.

/** Máximo de cuotas que se consideran (y de meses hacia atrás que se miran al armar un mes). */
export const MAX_INSTALLMENTS = 48;

export type WithMonth<T> = T & {
  /** Lo que corresponde al mes: la cuota, o el total si no es en cuotas. */
  monthCents: number;
  /** Qué cuota cae en el mes, si el gasto es en cuotas. */
  installment: { n: number; of: number } | null;
};

/** Meses entre dos "YYYY-MM" (o fechas "YYYY-MM-DD"). */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function installmentAmount(totalCents: number, count: number, n: number): number {
  const base = Math.trunc(totalCents / count);
  return n === 1 ? totalCents - base * (count - 1) : base;
}

/** Lo que queda por pagar después de la cuota n. */
export function remainingAfter(totalCents: number, count: number, n: number): number {
  return (count - n) * Math.trunc(totalCents / count);
}

function ownCount(tx: Tx): number {
  const n = Number(tx.installments);
  return Number.isInteger(n) && n > 1 ? Math.min(n, MAX_INSTALLMENTS) : 1;
}

/**
 * Cantidad de cuotas de cada movimiento: las propias, o las del pago que lo cubre. Así, si
 * pagaste en 6 cuotas algo que cargaste en Splitwise, tu parte también se reparte en 6 meses; y
 * si el aviso de Santander dice 6 cuotas pero el mail de Mercado Pago no, cuenta igual en cuotas.
 */
export function installmentCounts(txs: Tx[]): Map<string, number> {
  const counts = new Map(txs.map((t) => [t.id, ownCount(t)]));
  const hasOwn = new Set(txs.filter((t) => ownCount(t) > 1).map((t) => t.id));
  // Se repite por si hay cadenas de vínculos (Santander → Mercado Pago → Splitwise).
  for (let pass = 0, changed = true; changed && pass < 5; pass++) {
    changed = false;
    for (const t of txs) {
      const target = t.linkedTo;
      const count = counts.get(t.id) ?? 1;
      if (target && counts.has(target) && !hasOwn.has(target) && count > (counts.get(target) ?? 1)) {
        counts.set(target, count);
        changed = true;
      }
    }
  }
  return counts;
}

/**
 * Lo que aporta cada movimiento a un mes: los del mes, más las cuotas de compras anteriores que
 * caen en él. `txs` tiene que incluir las compras de hasta MAX_INSTALLMENTS meses antes.
 */
export function entriesForMonth<T extends Tx>(txs: T[], month: string): WithMonth<T>[] {
  const counts = installmentCounts(txs);
  const entries: WithMonth<T>[] = [];
  for (const tx of txs) {
    const of = counts.get(tx.id) ?? 1;
    const n = monthsBetween(tx.date, month) + 1;
    if (n < 1 || n > of) continue;
    entries.push({
      ...tx,
      monthCents: of > 1 ? installmentAmount(tx.amountCents, of, n) : tx.amountCents,
      installment: of > 1 ? { n, of } : null,
    });
  }
  return entries;
}
