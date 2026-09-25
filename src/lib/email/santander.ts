import { categorize } from "../categories";
import { toLocalDate } from "../dates";
import {
  cleanValue,
  findCard,
  findInstallments,
  findLabeledDate,
  findLabeledMoney,
  findLabeledValue,
  findMoneyAfter,
  findOnlyMoney,
  firstLines,
} from "./extract";
import { failed, skipped, type EmailParser } from "./types";

// Formato de los avisos de consumo de Santander (verificado con mails reales, sep. 2026):
//
//   De:      Aviso Santander <mensajesyavisos@mails.santander.com.ar>
//   Asunto:  Pagaste $99.000,00
//   Cuerpo:  "Te acercamos el detalle de tu consumo con la Tarjeta Santander Visa Crédito
//            terminada en 1234." + tabla con Monto, Cuotas (solo crédito), Comercio, Fecha, Hora.
//
// Igual el parser acepta variantes (frases, etiquetas con ":"), por si Santander cambia el
// formato o manda otros tipos de aviso. Lo que no entiende queda en "Mails sin procesar".

const ALERT_SUBJECT = /pagaste|consumo|compra|anulaci[oó]n|devoluci[oó]n|d[eé]bito|pago/i;
const NOT_SPENDING = /resumen|pago (?:de|del) (?:tu |la )?(?:tarjeta|resumen)/i;
const REJECTED = /rechaz|denegad|no (?:fue )?aprobad/i;
const REFUND = /anulaci[oó]n|devoluci[oó]n|contracargo/i;

const AMOUNT_LABELS = ["monto", "importe", "total", "valor"];
const MERCHANT_LABELS = ["comercio", "establecimiento", "raz[oó]n social", "descripci[oó]n", "detalle", "lugar"];
const AMOUNT_WORDS = ["pagaste", "consumo", "compra", "pago", "d[eé]bito", "transacci[oó]n", "operaci[oó]n"];

export const santanderParser: EmailParser = {
  id: "santander",
  label: "Santander (avisos de consumo)",
  defaultQuery: "from:mensajesyavisos@mails.santander.com.ar",
  envVar: "SANTANDER_GMAIL_QUERY",

  parse(email) {
    const { subject, text } = email;
    if (!ALERT_SUBJECT.test(subject)) return skipped("El asunto no parece un aviso de consumo");
    if (NOT_SPENDING.test(subject)) return skipped("Pago de la tarjeta o resumen, no es un consumo");
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
    // Sin comercio no se acepta: evita tomar como consumo otros avisos con importe
    // (pago del resumen, transferencias) y deja el mail a la vista para revisarlo.
    if (!merchant) return failed("Encontré el importe pero no el comercio: formato desconocido");

    return {
      status: "parsed",
      expense: {
        date: findLabeledDate(full) ?? toLocalDate(email.date),
        description: merchant,
        amountCents: REFUND.test(subject) ? -money.cents : money.cents,
        currency: money.currency,
        category: categorize(merchant) ?? "Otros",
        card: findCard(full),
        installments: findInstallments(full),
      },
    };
  },
};
