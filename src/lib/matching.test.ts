import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { applyAutoLinks, findLinks } from "./matching";
import { mapExpense, type SplitwiseExpense } from "./splitwise";
import { getAllTransactions, isCounted, summarize, unlink, upsertTransaction, type Tx } from "./transactions";

const tx = (partial: Partial<Tx> & Pick<Tx, "id" | "source" | "amountCents">): Tx => ({
  date: "2026-09-10",
  description: "algo",
  currency: "ARS",
  paidCents: null,
  totalCents: null,
  category: null,
  card: null,
  installments: null,
  linkedTo: null,
  linkLocked: false,
  ignored: false,
  ...partial,
});

describe("findLinks", () => {
  it("vincula un pago con tarjeta al gasto de Splitwise que pagaste vos", () => {
    const links = findLinks([
      tx({ id: "santander:1", source: "santander", amountCents: 4000000, date: "2026-09-10" }),
      tx({ id: "splitwise:9", source: "splitwise", amountCents: 1000000, paidCents: 4000000, date: "2026-09-11" }),
    ]);
    expect(links).toEqual([{ from: "santander:1", to: "splitwise:9" }]);
  });

  it("no vincula si pagó otro, si la moneda difiere o si las fechas están lejos", () => {
    expect(
      findLinks([
        tx({ id: "santander:1", source: "santander", amountCents: 4000000 }),
        tx({ id: "splitwise:1", source: "splitwise", amountCents: 1000000, paidCents: 0 }),
        tx({ id: "splitwise:2", source: "splitwise", amountCents: 1000000, paidCents: 4000000, currency: "USD" }),
        tx({ id: "splitwise:3", source: "splitwise", amountCents: 1000000, paidCents: 4000000, date: "2026-09-30" }),
      ]),
    ).toEqual([]);
  });

  it("encadena Santander (MERPAGO) → Mercado Pago → Splitwise", () => {
    const links = findLinks([
      tx({ id: "santander:1", source: "santander", description: "MERPAGO*CAFEMARTINEZ", amountCents: 900000 }),
      tx({ id: "mercadopago:1", source: "mercadopago", description: "Café Martínez", amountCents: 900000 }),
      tx({ id: "splitwise:1", source: "splitwise", amountCents: 450000, paidCents: 900000 }),
    ]);
    expect(links).toEqual([
      { from: "santander:1", to: "mercadopago:1" },
      { from: "mercadopago:1", to: "splitwise:1" },
    ]);
  });

  it("cada gasto de Splitwise cubre a un solo pago", () => {
    const links = findLinks([
      tx({ id: "santander:1", source: "santander", amountCents: 500000, date: "2026-09-10" }),
      tx({ id: "santander:2", source: "santander", amountCents: 500000, date: "2026-09-11" }),
      tx({ id: "splitwise:1", source: "splitwise", amountCents: 250000, paidCents: 500000, date: "2026-09-11" }),
    ]);
    expect(links).toHaveLength(1);
  });
});

describe("mapExpense (Splitwise)", () => {
  const base: SplitwiseExpense = {
    id: 1,
    description: "Cena",
    cost: "40000.0",
    currency_code: "ARS",
    date: "2026-09-10T02:00:00Z",
    payment: false,
    deleted_at: null,
    group_id: 5,
    category: { id: 13, name: "Dining out" },
    users: [
      { user_id: 7, paid_share: "40000.0", owed_share: "10000.0" },
      { user_id: 8, paid_share: "0.0", owed_share: "30000.0" },
    ],
  };

  it("cuenta tu parte, en la fecha local", () => {
    expect(mapExpense(base, 7)).toMatchObject({
      id: "splitwise:1",
      amountCents: 1000000,
      paidCents: 4000000,
      totalCents: 4000000,
      date: "2026-09-09", // 02:00 UTC = 23:00 del día anterior en Buenos Aires
      category: "Comida y delivery",
    });
  });

  it("descarta pagos entre amigos, borrados y gastos donde no participás", () => {
    expect(mapExpense({ ...base, payment: true }, 7)).toBeNull();
    expect(mapExpense({ ...base, deleted_at: "2026-09-12T00:00:00Z" }, 7)).toBeNull();
    expect(mapExpense(base, 99)).toBeNull();
  });
});

describe("totales con la base de datos", () => {
  it("el pago con tarjeta vinculado no suma dos veces; al desvincular vuelve a contar", () => {
    const db = openDb(":memory:");
    upsertTransaction(db, {
      id: "santander:1",
      source: "santander",
      date: "2026-09-10",
      description: "LA PARRILLA",
      amountCents: 4000000,
      currency: "ARS",
    });
    upsertTransaction(db, {
      id: "splitwise:1",
      source: "splitwise",
      date: "2026-09-10",
      description: "Cena",
      amountCents: 1000000,
      paidCents: 4000000,
      totalCents: 4000000,
      currency: "ARS",
    });

    expect(applyAutoLinks(db)).toBe(1);
    expect(summarize(getAllTransactions(db)).totals).toEqual([{ currency: "ARS", cents: 1000000 }]);

    unlink(db, "santander:1");
    expect(applyAutoLinks(db)).toBe(0); // no se vuelve a vincular solo
    expect(getAllTransactions(db).filter(isCounted)).toHaveLength(2);
  });

  it("re-sincronizar no pisa la categoría elegida ni el estado ignorado", () => {
    const db = openDb(":memory:");
    const input = {
      id: "mercadopago:1",
      source: "mercadopago" as const,
      date: "2026-09-10",
      description: "Transferencia a Juan",
      amountCents: 100000,
      currency: "ARS",
      category: "Transferencias",
      ignoredByDefault: true,
    };
    upsertTransaction(db, input);
    db.prepare("UPDATE transactions SET category = 'Hogar y servicios', ignored = 0").run();
    upsertTransaction(db, input);
    const [row] = getAllTransactions(db);
    expect(row.category).toBe("Hogar y servicios");
    expect(row.ignored).toBe(false);
  });
});
