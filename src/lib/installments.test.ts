import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { entriesForMonth, installmentAmount, installmentCounts, remainingAfter } from "./installments";
import { applyAutoLinks } from "./matching";
import { installmentStats, listMonth, monthlyTotals, summarize, upsertTransaction, type Tx } from "./transactions";

const tx = (partial: Partial<Tx> & Pick<Tx, "id" | "amountCents" | "date">): Tx => ({
  source: "santander",
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

describe("installmentAmount", () => {
  it("reparte en partes iguales y los centavos sobrantes van en la primera cuota", () => {
    const cuotas = [1, 2, 3].map((n) => installmentAmount(10000000, 3, n));
    expect(cuotas).toEqual([3333334, 3333333, 3333333]);
    expect(cuotas.reduce((a, b) => a + b)).toBe(10000000);
    expect(remainingAfter(10000000, 3, 1)).toBe(6666666);
    expect(remainingAfter(10000000, 3, 3)).toBe(0);
  });
});

describe("entriesForMonth", () => {
  const compra = tx({ id: "santander:1", date: "2026-09-25", amountCents: 9900000, installments: "6" });

  it("suma una cuota por mes, desde el mes de la compra", () => {
    const porMes = ["2026-08", "2026-09", "2026-10", "2027-02", "2027-03"].map((m) =>
      entriesForMonth([compra], m).map((e) => [e.monthCents, e.installment]),
    );
    expect(porMes).toEqual([
      [],
      [[1650000, { n: 1, of: 6 }]],
      [[1650000, { n: 2, of: 6 }]],
      [[1650000, { n: 6, of: 6 }]],
      [],
    ]);
  });

  it("los gastos sin cuotas solo cuentan en su mes", () => {
    const comun = tx({ id: "santander:2", date: "2026-09-10", amountCents: 500000 });
    expect(entriesForMonth([comun], "2026-09")).toMatchObject([{ monthCents: 500000, installment: null }]);
    expect(entriesForMonth([comun], "2026-10")).toEqual([]);
  });

  it("el gasto que cubre a un pago en cuotas hereda las cuotas", () => {
    const tarjeta = { ...compra, linkedTo: "splitwise:1" };
    const splitwise = tx({ id: "splitwise:1", source: "splitwise", date: "2026-09-25", amountCents: 4950000 });
    expect(installmentCounts([tarjeta, splitwise]).get("splitwise:1")).toBe(6);
    expect(entriesForMonth([tarjeta, splitwise], "2026-11").find((e) => e.id === "splitwise:1")).toMatchObject({
      monthCents: 825000,
      installment: { n: 3, of: 6 },
    });
  });
});

describe("con la base de datos", () => {
  function seed() {
    const db = openDb(":memory:");
    upsertTransaction(db, {
      id: "santander:1",
      source: "santander",
      date: "2026-09-25",
      description: "MERPAGO*TIENDA",
      amountCents: 9900000,
      currency: "ARS",
      installments: "6",
    });
    upsertTransaction(db, {
      id: "santander:2",
      source: "santander",
      date: "2026-10-03",
      description: "COTO",
      amountCents: 2000000,
      currency: "ARS",
    });
    return db;
  }

  it("cada mes suma sus gastos más las cuotas que le tocan", () => {
    const db = seed();
    expect(summarize(listMonth(db, "2026-09")).totals).toEqual([{ currency: "ARS", cents: 1650000 }]);
    expect(summarize(listMonth(db, "2026-10")).totals).toEqual([{ currency: "ARS", cents: 3650000 }]);
    expect(monthlyTotals(db, "2026-08", "2026-10")).toEqual([
      { month: "2026-09", currency: "ARS", cents: 1650000 },
      { month: "2026-10", currency: "ARS", cents: 3650000 },
    ]);
  });

  it("informa las cuotas de compras anteriores y lo que queda por pagar", () => {
    const db = seed();
    expect(installmentStats(listMonth(db, "2026-10"), "2026-10")).toEqual({
      fromPrevious: [{ currency: "ARS", cents: 1650000 }],
      pending: [{ currency: "ARS", cents: 6600000 }],
    });
  });

  it("si el mail de Mercado Pago no trae cuotas pero el aviso de Santander sí, igual se reparte", () => {
    const db = seed();
    upsertTransaction(db, {
      id: "mercadopago:1",
      source: "mercadopago",
      date: "2026-09-25",
      description: "TIENDA",
      amountCents: 9900000,
      currency: "ARS",
    });
    applyAutoLinks(db); // Santander (MERPAGO*) queda cubierto por el pago de Mercado Pago
    const octubre = listMonth(db, "2026-10");
    expect(octubre.find((e) => e.id === "mercadopago:1")).toMatchObject({
      monthCents: 1650000,
      installment: { n: 2, of: 6 },
    });
    expect(summarize(octubre).totals).toEqual([{ currency: "ARS", cents: 3650000 }]);
  });
});
