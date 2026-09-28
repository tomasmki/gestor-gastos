const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  iexcl: "¡",
  iquest: "¿",
  ordm: "º",
  ordf: "ª",
  deg: "°",
  euro: "€",
  dollar: "$",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

/** Convierte el HTML de un mail a texto plano, dejando una celda/párrafo por línea. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/\r\n?/g, "\n") // los mails vienen con saltos de línea CRLF
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ​]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
