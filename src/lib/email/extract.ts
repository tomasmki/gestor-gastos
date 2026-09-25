// Heurísticas para sacar datos de mails de avisos (importe, comercio, tarjeta, fecha).

import { parseLooseDate } from "../dates";
import { detectCurrency, parseAmount, type Currency } from "../money";

export interface Money {
  cents: number;
  currency: Currency;
}

const CURRENCY = String.raw`(U\$S|US\$|U\$D|USD|ARS|\$)`;
const NUMBER = String.raw`(-?\d[\d.,]*)`;

function toMoney(symbol: string | undefined, number: string, context: string): Money | null {
  const cents = parseAmount(number.replace(/[.,]+$/, ""));
  if (cents == null || cents === 0) return null;
  const currency = (symbol && detectCurrency(symbol)) || detectCurrency(context) || "ARS";
  return { cents: Math.abs(cents), currency };
}

function alternatives(labels: string[]): string {
  return labels.join("|");
}

/** Todos los importes con símbolo de moneda que aparecen en el texto. */
export function findAllMoney(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(new RegExp(`${CURRENCY}\\s*${NUMBER}`, "gi"))) {
    const money = toMoney(m[1], m[2], "");
    if (money) out.push(money);
  }
  return out;
}

/** Importe que sigue a una etiqueta: "Importe: $ 1.234,56", "Monto\nU$S 10,00", "Total 1.234,56". */
export function findLabeledMoney(text: string, labels: string[]): Money | null {
  const withSymbol = new RegExp(
    `(?:${alternatives(labels)})[^\\d$\\n]{0,40}?\\s*${CURRENCY}\\s*${NUMBER}`,
    "i",
  ).exec(text);
  if (withSymbol) return toMoney(withSymbol[1], withSymbol[2], "");

  // Sin símbolo ("Importe en dólares: 10,00", "Monto 1.234"): la moneda sale del contexto cercano.
  const bare = new RegExp(`(?:${alternatives(labels)})(?:[^\\d\\n:]{0,25}:)?\\s*${NUMBER}`, "i").exec(text);
  if (bare) {
    const nearby = text.slice(bare.index, bare.index + bare[0].length + 20);
    return toMoney(undefined, bare[1], `${nearby} ${findLabeledValue(text, ["moneda"]) ?? ""}`);
  }
  return null;
}

/** Importe que sigue a un verbo/sustantivo: "compra de $ 100", "Pagaste $ 1.500". */
export function findMoneyAfter(text: string, words: string[]): Money | null {
  const m = new RegExp(
    `(?:${alternatives(words)})\\s+(?:(?:de|por)\\s+)?(?:un (?:importe|monto) de\\s+)?${CURRENCY}\\s*${NUMBER}`,
    "i",
  ).exec(text);
  return m ? toMoney(m[1], m[2], text) : null;
}

/** Si el texto tiene un único importe (aunque se repita), lo devuelve. */
export function findOnlyMoney(text: string): Money | null {
  const all = findAllMoney(text);
  const distinct = new Set(all.map((m) => `${m.currency}${m.cents}`));
  return distinct.size === 1 ? all[0] : null;
}

/**
 * Valor de un campo tipo "Comercio: COTO" o en tabla, con la etiqueta y el valor en líneas
 * separadas ("Comercio\nCOTO") o en la misma línea ("Comercio COTO"). La etiqueta tiene que
 * estar al principio de la línea. Las etiquetas se prueban en el orden dado.
 */
export function findLabeledValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const separated = new RegExp(
      `(?:^|\\n)[ \\t]*(?:${label})[ \\t]*(?::[ \\t]*|\\n[ \\t]*)(?:\\n[ \\t]*)?([^\\n]+)`,
      "i",
    ).exec(text);
    const sameLine = separated ?? new RegExp(`(?:^|\\n)[ \\t]*(?:${label})[ \\t]+([^\\n:]+)(?:\\n|$)`, "i").exec(text);
    const value = sameLine ? cleanValue(sameLine[1]) : null;
    if (value) return value;
  }
  return null;
}

export function cleanValue(s: string): string | null {
  const v = s
    .replace(/\s+/g, " ")
    .replace(/^[\s:|\-–]+|[\s.,;:|\-–]+$/g, "")
    .trim()
    .slice(0, 80);
  return v.length >= 2 ? v : null;
}

export function findCardLast4(text: string): string | null {
  const m =
    /(?:terminad[ao]|finalizad[ao]|termina|finaliza)\s+en\s*:?\s*(?:[*xX•·]+\s*)?(\d{4})\b/i.exec(text) ??
    /[*xX•·]{4,}[\s-]*(\d{4})\b/.exec(text);
  return m ? m[1] : null;
}

/**
 * Tarjeta con su tipo si el mail lo dice: "la Tarjeta Santander Visa Crédito terminada en 1234"
 * → "Visa Crédito 1234". Si no, solo los últimos 4 dígitos.
 */
export function findCard(text: string): string | null {
  const named =
    /tarjeta\s+(?:santander\s+)?([a-záéíóúü ]{2,30}?)\s+(?:terminad[ao]|finalizad[ao])\s+en\s*:?\s*(\d{4})\b/i.exec(
      text,
    );
  return named ? `${named[1].trim()} ${named[2]}` : findCardLast4(text);
}

/** Fecha que acompaña a una etiqueta "Fecha" (si el mail la informa). */
export function findLabeledDate(text: string): string | null {
  const m = /fecha\b[^\d]{0,25}?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.exec(text);
  return m ? parseLooseDate(m[1]) : null;
}

export function findInstallments(text: string): string | null {
  // "Cuotas\n6" (tabla) o "Cuotas: 6"; si no, "en 6 cuotas" (en la misma línea, para no tomar
  // los centavos de un importe de la línea anterior).
  const m = /cuotas\s*:?\s*(\d{1,2})\b/i.exec(text) ?? /\b(\d{1,2})[ \t]*cuotas\b/i.exec(text);
  return m && Number(m[1]) > 1 ? m[1] : null;
}

export function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}
