import { createHash } from "node:crypto";
import Papa from "papaparse";
import { categorize } from "./categories";
import { parseLooseDate } from "./dates";
import type { DB } from "./db";
import { detectCurrency, parseAmount } from "./money";
import { upsertTransaction, type Source, type TxInput } from "./transactions";

// Importador genérico de CSV (pensado para el reporte de actividad de Mercado Pago, pero sirve
// para cualquier export con columnas de fecha, descripción e importe). Detecta las columnas por
// el nombre del encabezado.

const DATE_COLS = [/^(fecha|date)$/i, /fecha|date/i];
const DESCRIPTION_COLS = [
  /^(descripci[oó]n|description|detalle|concepto)$/i,
  /descripci[oó]n|description|detalle|concepto|comercio|contraparte|raz[oó]n social/i,
];
const DEBIT_COLS = [/net_debit_amount|d[eé]bito|egreso/i];
const AMOUNT_COLS = [/^(monto|importe|amount|valor|total)$/i, /monto|importe|amount|valor/i];
const CURRENCY_COLS = [/moneda|currency/i];
const ID_COLS = [/^(source_id|operation_id|id de operaci[oó]n|n[uú]mero de operaci[oó]n|id)$/i];

// Movimientos que no son consumo: se importan ignorados.
const NOT_SPENDING = /transferencia|transferiste|enviaste dinero|pago (?:de )?(?:la )?tarjeta|pago de resumen|retiro|extracci[oó]n/i;

export interface CsvImportOptions {
  source: Extract<Source, "mercadopago" | "csv">;
  /** Si es true, los importes positivos son gastos; si no, los gastos son los negativos. */
  positiveIsExpense: boolean;
}

export interface CsvImportResult {
  imported: number;
  skipped: number;
  columns: { date: string; description: string; amount: string };
}

function findColumn(headers: string[], patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const found = headers.find((h) => re.test(h.trim()));
    if (found) return found;
  }
  return undefined;
}

export function parseCsv(content: string, options: CsvImportOptions): { rows: TxInput[]; result: CsvImportResult } {
  const parsed = Papa.parse<Record<string, string>>(content.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
  });
  const headers = parsed.meta.fields ?? [];
  const dateCol = findColumn(headers, DATE_COLS);
  const descCol = findColumn(headers, DESCRIPTION_COLS);
  const debitCol = findColumn(headers, DEBIT_COLS);
  const amountCol = debitCol ?? findColumn(headers, AMOUNT_COLS);
  const currencyCol = findColumn(headers, CURRENCY_COLS);
  const idCol = findColumn(headers, ID_COLS);

  if (!dateCol || !descCol || !amountCol) {
    throw new Error(
      `No pude identificar las columnas de fecha, descripción e importe. Encabezados encontrados: ${headers.join(", ") || "(ninguno)"}`,
    );
  }

  const rows: TxInput[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (const record of parsed.data) {
    const date = parseLooseDate(record[dateCol] ?? "");
    const description = (record[descCol] ?? "").trim();
    let cents = parseAmount(record[amountCol] ?? "");
    if (!date || !description || cents == null || cents === 0) {
      skipped++;
      continue;
    }
    if (!debitCol) {
      const isExpense = options.positiveIsExpense ? cents > 0 : cents < 0;
      if (!isExpense) {
        skipped++; // ingreso
        continue;
      }
    }
    cents = Math.abs(cents);

    const currency = detectCurrency(record[currencyCol ?? ""] ?? "") ?? "ARS";
    let key = record[idCol ?? ""]?.trim();
    if (!key) {
      // Sin id de operación: hash del contenido (+ nº de repetición para filas idénticas).
      const base = `${date}|${description}|${cents}|${currency}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      key = createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 16);
    }

    const notSpending = NOT_SPENDING.test(description);
    rows.push({
      id: `${options.source}:csv:${key}`,
      source: options.source,
      date,
      description,
      amountCents: cents,
      currency,
      category: notSpending ? "Transferencias" : (categorize(description) ?? "Otros"),
      ignoredByDefault: notSpending,
      raw: record,
    });
  }

  return {
    rows,
    result: { imported: rows.length, skipped, columns: { date: dateCol, description: descCol, amount: amountCol } },
  };
}

export function importCsv(db: DB, content: string, options: CsvImportOptions): CsvImportResult {
  const { rows, result } = parseCsv(content, options);
  db.transaction(() => rows.forEach((row) => upsertTransaction(db, row)))();
  return result;
}
