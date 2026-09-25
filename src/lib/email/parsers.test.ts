import { describe, expect, it } from "vitest";
import { htmlToText } from "../html";
import { mercadopagoParser } from "./mercadopago";
import { santanderParser } from "./santander";
import type { EmailMessage } from "./types";

const email = (subject: string, text: string, date = "2026-09-20T15:30:00Z"): EmailMessage => ({
  id: "abc",
  subject,
  from: "Aviso Santander <mensajesyavisos@mails.santander.com.ar>",
  date: new Date(date),
  text,
});

// Réplica del aviso real de Santander (sep. 2026) con datos inventados: título, frase con la
// tarjeta en negrita y tabla Monto / Cuotas / Comercio / Fecha / Hora.
function santanderAlert(rows: [string, string][], card = "Visa Crédito", last4 = "1234"): string {
  return `
    <html><head><style>td { font-family: Arial; }</style></head><body>
      <table><tr><td><img alt="Santander"></td></tr></table>
      <div><img alt=""><p><b>Información sobre tu pago</b></p></div>
      <div>
        <p>Te acercamos el detalle de tu consumo con la <b>Tarjeta Santander ${card}</b> terminada en <b>${last4}</b>.</p>
        <table>
          ${rows.map(([k, v]) => `<tr><td style="text-align:left">${k}</td><td style="text-align:right"><b>${v}</b></td></tr>`).join("\n")}
        </table>
      </div>
    </body></html>`;
}

describe("santanderParser: formato real", () => {
  it("consumo con tarjeta de crédito en cuotas", () => {
    const html = santanderAlert([
      ["Monto", "$99.000,00"],
      ["Cuotas", "6"],
      ["Comercio", "MERPAGO*TIENDAEJEMPLO"],
      ["Fecha", "25/09/2026"],
      ["Hora", "13:02"],
    ]);
    const result = santanderParser.parse(email("Pagaste $99.000,00", htmlToText(html), "2026-09-25T16:02:00Z"));
    expect(result).toEqual({
      status: "parsed",
      expense: {
        date: "2026-09-25",
        description: "MERPAGO*TIENDAEJEMPLO",
        amountCents: 9900000,
        currency: "ARS",
        category: "Otros",
        card: "Visa Crédito 1234",
        installments: "6",
      },
    });
  });

  it("consumo con tarjeta de débito (sin fila de cuotas)", () => {
    const html = santanderAlert(
      [
        ["Monto", "$1.192,99"],
        ["Comercio", "MERPAGO*AUSOL"],
        ["Fecha", "25/09/2026"],
        ["Hora", "10:47"],
      ],
      "Visa Débito",
      "5678",
    );
    const result = santanderParser.parse(email("Pagaste $1.192,99", htmlToText(html)));
    expect(result).toMatchObject({
      status: "parsed",
      expense: {
        description: "MERPAGO*AUSOL",
        amountCents: 119299,
        card: "Visa Débito 5678",
        installments: null,
        category: "Transporte",
      },
    });
  });

  it("si el comercio y el monto vienen en la misma línea que la etiqueta", () => {
    const text = "Te acercamos el detalle de tu consumo con la Tarjeta Santander Visa Débito terminada en 5678.\nMonto $10.000,00\nComercio SACOA\nFecha 23/09/2026";
    const result = santanderParser.parse(email("Pagaste $10.000,00", text));
    expect(result).toMatchObject({
      status: "parsed",
      expense: { description: "SACOA", amountCents: 1000000, date: "2026-09-23", category: "Entretenimiento" },
    });
  });

  it("no toma el pago del resumen de la tarjeta como consumo", () => {
    const text = "Tarjeta Santander Visa Crédito terminada en 1234\nMonto $500.000,00";
    expect(santanderParser.parse(email("Pago de tu tarjeta acreditado", text)).status).toBe("skipped");
    expect(santanderParser.parse(email("Recibimos tu pago", text)).status).toBe("failed");
  });
});

// Variantes que no vimos en mails reales pero podrían aparecer.
describe("santanderParser: variantes", () => {
  it("lee un aviso en formato tabla (etiqueta y valor en líneas separadas)", () => {
    const html = `
      <table>
        <tr><td>Tarjeta</td><td>VISA terminada en 1234</td></tr>
        <tr><td>Comercio</td><td>COTO SUC 45</td></tr>
        <tr><td>Importe</td><td>$ 12.345,67</td></tr>
        <tr><td>Fecha</td><td>19/09/2026 21:14</td></tr>
      </table>
      <p>Aprovechá 30% de reintegro hasta $ 10.000 en supermercados.</p>`;
    const result = santanderParser.parse(email("Aviso de consumo con tu tarjeta", htmlToText(html)));
    expect(result).toEqual({
      status: "parsed",
      expense: expect.objectContaining({
        description: "COTO SUC 45",
        amountCents: 1234567,
        currency: "ARS",
        card: "VISA 1234",
        date: "2026-09-19",
        category: "Supermercado",
      }),
    });
  });

  it("lee un aviso en formato frase, en dólares", () => {
    const result = santanderParser.parse(
      email(
        "Realizaste una compra",
        "Hola Tomás, realizaste una compra de U$S 9,99 en NETFLIX.COM con tu tarjeta Visa terminada en 1234.",
      ),
    );
    expect(result).toMatchObject({
      status: "parsed",
      expense: { description: "NETFLIX.COM", amountCents: 999, currency: "USD", card: "Visa 1234", date: "2026-09-20" },
    });
  });

  it("detecta cuotas", () => {
    const result = santanderParser.parse(
      email("Consumo aprobado", "Comercio: FRAVEGA\nImporte: $ 300.000,00\nPlan: 6 cuotas\nTarjeta terminada en 9876"),
    );
    expect(result).toMatchObject({ status: "parsed", expense: { installments: "6", category: "Compras" } });
  });

  it("las anulaciones restan", () => {
    const result = santanderParser.parse(
      email("Anulación de consumo", "Comercio: ZARA\nImporte: $ 50.000\nTarjeta terminada en 1234"),
    );
    expect(result).toMatchObject({ status: "parsed", expense: { amountCents: -5000000 } });
  });

  it("ignora operaciones rechazadas", () => {
    const result = santanderParser.parse(
      email("Consumo rechazado", "Tu compra de $ 1.000 en STEAM fue rechazada: código de seguridad incorrecto."),
    );
    expect(result.status).toBe("skipped");
  });

  it("ignora mails que no son avisos", () => {
    expect(santanderParser.parse(email("¡Nuevos beneficios para vos!", "Hasta $ 20.000 de reintegro")).status).toBe(
      "skipped",
    );
  });

  it("marca como fallido un aviso que no entiende", () => {
    const result = santanderParser.parse(email("Aviso de consumo", "Se registró un movimiento de $ 1.000."));
    expect(result.status).toBe("failed");
  });
});

describe("mercadopagoParser", () => {
  it("lee un pago a un comercio", () => {
    const result = mercadopagoParser.parse(
      email("Pagaste $ 4.500 en Café Martínez", "Detalle del pago\nTotal $ 4.500\nMedio de pago: Dinero disponible"),
    );
    expect(result).toMatchObject({
      status: "parsed",
      expense: { description: "Café Martínez", amountCents: 450000, currency: "ARS" },
    });
  });

  it("importa transferencias a personas como ignoradas", () => {
    const result = mercadopagoParser.parse(email("Transferiste $ 10.000 a Juan Pérez", "Número de operación 123"));
    expect(result).toMatchObject({
      status: "parsed",
      expense: {
        description: "Transferencia a Juan Pérez",
        amountCents: 1000000,
        category: "Transferencias",
        ignoredByDefault: true,
      },
    });
  });

  it("ignora ingresos", () => {
    expect(mercadopagoParser.parse(email("Recibiste $ 5.000 de María", "")).status).toBe("skipped");
    expect(mercadopagoParser.parse(email("Juan te transfirió $ 5.000", "")).status).toBe("skipped");
  });
});

describe("htmlToText", () => {
  it("decodifica entidades y separa celdas en líneas", () => {
    expect(htmlToText("<tr><td>Descripci&oacute;n</td><td>Caf&eacute;&nbsp;&amp; bar</td></tr>")).toBe(
      "Descripción\nCafé & bar",
    );
  });
});
