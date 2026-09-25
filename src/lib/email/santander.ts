import { categorize } from "../categories";
import { toLocalDate } from "../dates";
import {
  cleanValue,
  findCardLast4,
  findInstallments,
  findLabeledDate,
  findLabeledMoney,
  findLabeledValue,
  findMoneyAfter,
  findOnlyMoney,
  firstLines,
} from "./extract";
import { failed, skipped, type EmailParser } from "./types";

// El formato exacto de los avisos de Santander no está documentado públicamente, así que el
// parser es tolerante: busca el importe y el comercio con varias formas posibles. Los mails
// que no logra interpretar quedan en "Conexiones → Mails sin procesar" para revisarlos.

const ALERT_SUBJECT = /consumo|compra|transacci[oó]n|operaci[oó]n|aviso|alerta|d[eé]bito|pago/i;
const REJECTED = /rechaz|denegad|no (?:fue )?aprobad/i;
const REFUND = /anulaci[oó]n|devoluci[oó]n|contracargo/i;

const AMOUNT_LABELS = ["importe", "monto", "total", "valor"];
const MERCHANT_LABELS = ["comercio", "establecimiento", "lugar", "descripci[oó]n", "detalle", "raz[oó]n social"];
const AMOUNT_WORDS = ["consumo", "compra", "pago", "d[eé]bito", "transacci[oó]n", "operaci[oó]n"];

export const santanderParser: EmailParser = {
  id: "santander",
  label: "Santander (avisos de consumo)",
  defaultQuery: "from:santander",
  envVar: "SANTANDER_GMAIL_QUERY",

  parse(email) {
    const { subject, text } = email;
    if (!ALERT_SUBJECT.test(subject)) return skipped("El asunto no parece un aviso de consumo");
    if (REJECTED.test(subject) || REJECTED.test(firstLines(text, 15))) {
      return skipped("Operación rechazada");
    }

    const full = `${subject}\n${text}`;
    const money =
      findLabeledMoney(full, AMOUNT_LABELS) ?? findMoneyAfter(full, AMOUNT_WORDS) ?? findOnlyMoney(full);
    if (!money) return failed("No encontré el importe (o había varios y no supe cuál era)");

    const merchant =
      findLabeledValue(full, MERCHANT_LABELS) ??
      cleanValue(
        /(?:consumo|compra|pago)[^\n]{0,60}?\sen\s+([A-Z0-9][^\n]{1,60}?)(?:\s+(?:el|con|por)\s|[.,]\s|\n|$)/i.exec(
          full,
        )?.[1] ?? "",
      );
    const card = findCardLast4(full);
    if (!merchant && !card) {
      return failed("Encontré el importe pero no el comercio ni la tarjeta: formato desconocido");
    }

    const description = merchant ?? "Consumo tarjeta Santander";
    return {
      status: "parsed",
      expense: {
        date: findLabeledDate(full) ?? toLocalDate(email.date),
        description,
        amountCents: REFUND.test(subject) ? -money.cents : money.cents,
        currency: money.currency,
        category: categorize(description) ?? "Otros",
        card,
        installments: findInstallments(full),
      },
    };
  },
};
