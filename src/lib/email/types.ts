import type { TxInput } from "../transactions";

export interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  date: Date;
  /** Cuerpo del mail como texto plano (el HTML ya convertido). */
  text: string;
}

export type ParsedExpense = Omit<TxInput, "id" | "source" | "raw">;

export type ParseResult =
  | { status: "parsed"; expense: ParsedExpense }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export interface EmailParser {
  id: "santander" | "mercadopago";
  label: string;
  /** Búsqueda de Gmail por defecto; se puede pisar con la variable de entorno `envVar`. */
  defaultQuery: string;
  envVar: string;
  parse(email: EmailMessage): ParseResult;
}

export const skipped = (reason: string): ParseResult => ({ status: "skipped", reason });
export const failed = (reason: string): ParseResult => ({ status: "failed", reason });
