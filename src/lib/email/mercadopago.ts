import { categorize } from "../categories";
import { toLocalDate } from "../dates";
import {
  cleanValue,
  findCard,
  findInstallments,
  findLabeledMoney,
  findLabeledValue,
  findMoneyAfter,
  findOnlyMoney,
} from "./extract";
import { failed, skipped, type EmailParser } from "./types";

// Mails de Mercado Pago por pagos/transferencias hechas desde tu cuenta.
//
// Formato verificado con un mail real (sep. 2026) de un pago en un comercio:
//   De:      Mercado Pago <info@mercadopago.com>
//   Asunto:  Pago aprobado en COMERCIO
//   Cuerpo:  "Le compraste a COMERCIO" / "Tu pago fue aprobado" / "Pagaste $ 28.500" y debajo
//            el medio de pago ("Dinero disponible", o la tarjeta).
//
// Otros tipos (transferencias, servicios) todavía no se vieron en mails reales: el parser los
// intenta leer con heurísticas y lo que no entiende queda en "Mails sin procesar".

const INCOME = /recibiste|te (?:envi|transfiri|pag)|cobraste|ingresaste|cargaste dinero|depositaste|acreditamos|reintegro|devoluci[oó]n/i;
const NOT_DONE = /rechaz|pendiente|no pudimos|cancelad|en proceso|venc/i;
const OUTGOING = /pagaste|tu pago|pago (?:aprobado|realizado|acreditado)|transferiste|enviaste|compraste|tu compra|d[eé]bito|recarga/i;
const TRANSFER = /transferi|transferencia|enviaste/i;

const AMOUNT_LABELS = ["total", "monto", "importe"];
const AMOUNT_WORDS = ["pagaste", "transferiste", "enviaste", "pago de", "compra de"];
const COUNTERPART_LABELS = ["destinatario", "para", "comercio", "vendedor", "le pagaste a", "pagaste a"];
// "Tu pago a Juan Pérez fue aprobado", "Pagaste $ 1.500 en Café Martínez", "Transferiste $ 100 a María"
const COUNTERPART_RE = /\s(?:a|en)\s+(.+?)(?:\s+(?:fue|se|est[aá]|ha|con|por)\b|[.!]|\n|$)/i;
// El texto viene duplicado (versión desktop y mobile): "Le compraste a X Le compraste a X".
const BOUGHT_FROM_RE = /le compraste a\s+(.+?)(?=\s+le compraste a|\n|$)/i;
// Línea que sigue a "Pagaste $ 28.500": el medio de pago.
const PAYMENT_METHOD_RE = /pagaste\s+(?:U\$S|US\$|\$)\s*[\d.,]+[^\n]*\n([^\n]{3,40})(?:\n|$)/i;

/** "Dinero disponible", "Visa Débito ****1234" → "Visa Débito 1234" (null si no se reconoce). */
export function findPaymentMethod(text: string): string | null {
  const line = PAYMENT_METHOD_RE.exec(text)?.[1];
  if (!line || /cuota|si necesit/i.test(line)) return null;
  return cleanValue(line.replace(/[*•·xX]{2,}\s*(?=\d{4}\b)/, " "));
}

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
      cleanValue(BOUGHT_FROM_RE.exec(text)?.[1] ?? "") ??
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
        card: findPaymentMethod(text) ?? findCard(full),
        installments: findInstallments(full),
        ignoredByDefault: isTransfer,
      },
    };
  },
};
