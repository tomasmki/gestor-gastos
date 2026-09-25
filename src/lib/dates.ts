import { timezone } from "./config";

/** Fecha local (YYYY-MM-DD) de un instante, en la zona horaria configurada. */
export function toLocalDate(d: Date, tz = timezone()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Interpreta fechas en los formatos habituales de mails y CSVs:
 * "25/09/2026", "25/09/26", "25-09-2026", "2026-09-25", "2026-09-25T13:45:00-03:00".
 */
export function parseLooseDate(s: string): string | null {
  const text = s.trim();

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}.*))?$/);
  if (iso) {
    if (iso[4]) {
      const d = new Date(text.replace(" ", "T"));
      if (!Number.isNaN(d.getTime())) return toLocalDate(d);
    }
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dmy = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/);
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return validDate(year, Number(dmy[2]), Number(dmy[1]));
  }
  return null;
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** "2026-09" + n meses */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  return toLocalDate(new Date()).slice(0, 7);
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
