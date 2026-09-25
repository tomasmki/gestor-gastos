import { describe, expect, it } from "vitest";
import { htmlToText } from "../html";
import { mercadopagoParser } from "./mercadopago";
import { santanderParser } from "./santander";
import type { EmailMessage } from "./types";

// OJO: estos mails son de ejemplo, armados a partir de formatos típicos de avisos bancarios.
// Cuando tengas un mail real (con los datos sensibles tapados), agregalo acá como caso de test.

const email = (subject: string, text: string, date = "2026-09-20T15:30:00Z"): EmailMessage => ({
  id: "abc",
  subject,
  from: "Santander <avisos@santander.com.ar>",
  date: new Date(date),
  text,
});

describe("santanderParser", () => {
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
        card: "1234",
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
      expense: { description: "NETFLIX.COM", amountCents: 999, currency: "USD", card: "1234", date: "2026-09-20" },
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
