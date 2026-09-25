import { mercadopagoParser } from "./mercadopago";
import { santanderParser } from "./santander";
import type { EmailParser } from "./types";

export const PARSERS: EmailParser[] = [santanderParser, mercadopagoParser];

export function parserById(id: string): EmailParser | undefined {
  return PARSERS.find((p) => p.id === id);
}

export function gmailQuery(parser: EmailParser): string {
  return process.env[parser.envVar] || parser.defaultQuery;
}
