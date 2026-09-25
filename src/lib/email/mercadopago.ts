import { categorize } from "../categories";
import { toLocalDate } from "../dates";
import {
  cleanValue,
  findCardLast4,
  findLabeledMoney,
  findLabeledValue,
  findMoneyAfter,
  findOnlyMoney,
} from "./extract";
import { failed, skipped, type EmailParser } from "./types";

// Mails de Mercado Pago por pagos/transferencias hechas desde tu cuenta. Igual que con
// Santander, el parser es heurístico y lo que no entiende queda para revisar.

const INCOME = /recibiste|te (?:envi|transfiri|pag)|cobraste|ingresaste|cargaste dinero|depositaste|acreditamos|reintegro|devoluci[oó]n/i;
const NOT_DONE = /rechaz|pendiente|no pudimos|cancelad|en proceso|venc/i;
const OUTGOING = /pagaste|tu pago|pago (?:aprobado|realizado|acreditado)|transferiste|enviaste|compraste|tu compra|d[eé]bito|recarga/i;
const TRANSFER = /transferi|transferencia|enviaste/i;

const AMOUNT_LABELS = ["total", "monto", "importe"];
const AMOUNT_WORDS = ["pagaste", "transferiste", "enviaste", "pago de", "compra de"];
const COUNTERPART_LABELS = ["destinatario", "para", "comercio", "vendedor", "le pagaste a", "pagaste a"];
// "Tu pago a Juan Pérez fue aprobado", "Pagaste $ 1.500 en Café Martínez", "Transferiste $ 100 a María"
const COUNTERPART_RE = /\s(?:a|en)\s+(.+?)(?:\s+(?:fue|se|est[aá]|ha|con|por)\b|[.!]|\n|$)/i;

export const mercadopagoParser: EmailParser = {
  id: "mercadopago",
  label: "Mercado Pago (pagos y transferencias)",
  defaultQuery: "from:mercadopago",
  envVar: "MERCADOPAGO_GMAIL_QUERY",

  parse(email) {
    const { subject, text } = email;
    if (INCOME.test(subject)) return skipped("Es un ingreso, no un gasto");
    if (NOT_DONE.test(subject)) return skipped("El pago no se concretó");
    if (!OUTGOING.test(subject)) return skipped("El asunto no parece un pago");

    const full = `${subject}\n${text}`;
    const money =
      findMoneyAfter(full, AMOUNT_WORDS) ?? findLabeledMoney(full, AMOUNT_LABELS) ?? findOnlyMoney(full);
    if (!money) return failed("No encontré el importe (o había varios y no supe cuál era)");

    const counterpart =
      cleanValue(COUNTERPART_RE.exec(subject)?.[1] ?? "") ??
      findLabeledValue(text, COUNTERPART_LABELS) ??
      cleanValue(COUNTERPART_RE.exec(text)?.[1] ?? "");

    // Las transferencias a personas suelen ser devoluciones de deudas (p. ej. saldar Splitwise),
    // así que se importan pero arrancan ignoradas: se pueden contar a mano desde el listado.
    const isTransfer = TRANSFER.test(subject);
    const description = isTransfer
      ? `Transferencia a ${counterpart ?? "desconocido"}`
      : (counterpart ?? "Pago con Mercado Pago");

    return {
      status: "parsed",
      expense: {
        date: toLocalDate(email.date),
        description,
        amountCents: money.cents,
        currency: money.currency,
        category: isTransfer ? "Transferencias" : (categorize(description) ?? "Otros"),
        card: findCardLast4(full),
        ignoredByDefault: isTransfer,
      },
    };
  },
};
