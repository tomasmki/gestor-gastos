import { describe, expect, it } from "vitest";
import { extractText } from "./gmail";

const b64 = (s: string, encoding: BufferEncoding = "utf8") => Buffer.from(s, encoding).toString("base64url");

describe("extractText", () => {
  it("prefiere la parte HTML y la convierte a texto", () => {
    const text = extractText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Ver en el navegador") } },
        { mimeType: "text/html", body: { data: b64("<p>Comercio</p><p>COTO</p>") } },
      ],
    });
    expect(text).toBe("Comercio\nCOTO");
  });

  it("respeta el charset declarado (mails en ISO-8859-1)", () => {
    const text = extractText({
      mimeType: "text/plain",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: b64("Débito en cuenta", "latin1") },
    });
    expect(text).toBe("Débito en cuenta");
  });
});
