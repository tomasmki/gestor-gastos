import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractText } from "../gmail";
import { mercadopagoParser } from "./mercadopago";
import { santanderParser } from "./santander";
import type { EmailMessage } from "./types";

// HTML de mails reales (sep. 2026) con los datos personales reemplazados. Se arma un mensaje
// igual al que devuelve la API de Gmail para probar el camino completo: decodificación,
// HTML → texto (con los saltos de línea CRLF originales) y parser.

function gmailMessage(fixture: string, subject: string, date: string): EmailMessage {
  const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures", fixture), "utf8");
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "text/html",
        headers: [{ name: "Content-Type", value: "text/html;charset=UTF-8" }],
        body: { data: Buffer.from(html, "utf8").toString("base64url") },
      },
    ],
  };
  return { id: "real", subject, from: "", date: new Date(date), text: extractText(payload) };
}

describe("mails reales", () => {
  it("Santander: consumo con tarjeta de débito", () => {
    const email = gmailMessage("santander-debito.html", "Pagaste $100.000,00", "2026-09-28T12:02:31Z");
    expect(santanderParser.parse(email)).toEqual({
      status: "parsed",
      expense: {
        date: "2026-09-28",
        description: "YPF SUCURSAL CENTRO",
        amountCents: 10000000,
        currency: "ARS",
        category: "Transporte",
        card: "Visa Débito 1234",
        installments: null,
      },
    });
  });

  it("Mercado Pago: pago en un comercio con dinero disponible", () => {
    const email = gmailMessage(
      "mercadopago-pago-aprobado.html",
      "Pago aprobado en COMERCIO EJEMPLO",
      "2026-09-26T15:08:05Z",
    );
    expect(mercadopagoParser.parse(email)).toEqual({
      status: "parsed",
      expense: {
        date: "2026-09-26",
        description: "COMERCIO EJEMPLO",
        amountCents: 2850000,
        currency: "ARS",
        category: "Otros",
        card: "Dinero disponible",
        installments: null,
        ignoredByDefault: false,
      },
    });
  });

  it("el texto extraído no arrastra líneas vacías ni retornos de carro", () => {
    const { text } = gmailMessage("santander-debito.html", "", "2026-09-28T12:02:31Z");
    expect(text).not.toMatch(/\r|\n\s*\n/);
    expect(text).toContain("Monto\n$100.000,00\nComercio\nYPF SUCURSAL CENTRO\nFecha\n28/09/2026");
  });
});
