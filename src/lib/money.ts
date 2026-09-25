export type Currency = "ARS" | "USD";

/**
 * Convierte un importe escrito como en los mails/CSVs a centavos.
 * Soporta formato argentino ("12.345,67"), anglosajón ("12,345.67") y sin separadores.
 * Si hay un solo tipo de separador seguido de exactamente 3 dígitos se lo toma como
 * separador de miles ("1.234" = mil doscientos treinta y cuatro).
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const negative = cleaned.trimStart().startsWith("-");
  const body = cleaned.replace(/-/g, "");

  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  let intPart: string;
  let decPart = "";

  if (lastDot >= 0 && lastComma >= 0) {
    const idx = Math.max(lastDot, lastComma);
    intPart = body.slice(0, idx).replace(/[.,]/g, "");
    decPart = body.slice(idx + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const parts = body.split(lastComma >= 0 ? "," : ".");
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length !== 3) {
      intPart = parts[0];
      decPart = last;
    } else {
      intPart = parts.join("");
    }
  } else {
    intPart = body;
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart) || intPart + decPart === "") return null;
  const cents = Number(intPart || "0") * 100 + Number((decPart + "00").slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** "12.50" (formato de la API de Splitwise) → 1250 */
export function decimalToCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

const USD_RE = /U\$S|US\$|U\$D|USD|d[oó]lar/i;
const ARS_RE = /\$|ARS|\bpesos?\b/i;

export function detectCurrency(text: string): Currency | null {
  if (USD_RE.test(text)) return "USD";
  if (ARS_RE.test(text)) return "ARS";
  return null;
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}
