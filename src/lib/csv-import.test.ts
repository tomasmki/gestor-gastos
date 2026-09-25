import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv-import";

describe("parseCsv", () => {
  it("importa los egresos (negativos) y omite ingresos", () => {
    const csv = [
      "Fecha;Descripción;Monto;Número de operación",
      "20/09/2026;Pago en COTO;-15.000,50;111",
      "21/09/2026;Ingreso de dinero;50.000,00;112",
      "22/09/2026;Transferencia enviada a Juan;-5.000,00;113",
    ].join("\n");
    const { rows, result } = parseCsv(csv, { source: "mercadopago", positiveIsExpense: false });
    expect(result).toMatchObject({ imported: 2, skipped: 1 });
    expect(rows[0]).toMatchObject({
      id: "mercadopago:csv:111",
      date: "2026-09-20",
      amountCents: 1500050,
      category: "Supermercado",
      ignoredByDefault: false,
    });
    expect(rows[1]).toMatchObject({ category: "Transferencias", ignoredByDefault: true });
  });

  it("usa la columna de débitos del reporte de Mercado Pago si existe", () => {
    const csv = [
      "DATE,SOURCE_ID,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT",
      "2026-09-20T10:00:00.000-03:00,999,payment,0.00,1500.00",
      "2026-09-21T10:00:00.000-03:00,998,payment,2000.00,0.00",
    ].join("\n");
    const { rows } = parseCsv(csv, { source: "mercadopago", positiveIsExpense: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "mercadopago:csv:999", amountCents: 150000, date: "2026-09-20" });
  });

  it("genera ids estables sin columna de id, distinguiendo filas repetidas", () => {
    const csv = "fecha,detalle,importe\n2026-09-01,Cafe,-100\n2026-09-01,Cafe,-100\n";
    const a = parseCsv(csv, { source: "csv", positiveIsExpense: false }).rows.map((r) => r.id);
    const b = parseCsv(csv, { source: "csv", positiveIsExpense: false }).rows.map((r) => r.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(2);
  });

  it("explica qué encabezados encontró si no reconoce las columnas", () => {
    expect(() => parseCsv("a,b\n1,2", { source: "csv", positiveIsExpense: false })).toThrow(/a, b/);
  });
});
