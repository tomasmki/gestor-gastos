"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CATEGORIES } from "@/lib/categories";
import { importCsv } from "@/lib/csv-import";
import { parseLooseDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { disconnectGmail } from "@/lib/gmail";
import { applyAutoLinks } from "@/lib/matching";
import { parseAmount } from "@/lib/money";
import { reprocessEmails, syncAll } from "@/lib/sync";
import { addManual, deleteTransaction, setCategory, setIgnored, unlink } from "@/lib/transactions";

function refresh() {
  revalidatePath("/");
  revalidatePath("/conexiones");
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function syncAction() {
  await syncAll(getDb());
  refresh();
}

export async function reprocessEmailsAction() {
  const counts = reprocessEmails(getDb());
  refresh();
  redirect(
    `/conexiones?ok=${encodeURIComponent(
      `Mails reprocesados: ${counts.parsed} gastos, ${counts.skipped} ignorados, ${counts.failed} sin entender.`,
    )}`,
  );
}

export async function dismissEmailAction(form: FormData) {
  getDb()
    .prepare("UPDATE emails SET status = 'skipped', reason = 'Descartado a mano' WHERE id = ?")
    .run(field(form, "id"));
  refresh();
}

export async function disconnectGmailAction() {
  await disconnectGmail(getDb());
  refresh();
}

export async function importCsvAction(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/conexiones?error=${encodeURIComponent("Elegí un archivo CSV.")}`);
  }
  let message: string;
  try {
    const db = getDb();
    const result = importCsv(db, await file.text(), {
      source: field(form, "source") === "csv" ? "csv" : "mercadopago",
      positiveIsExpense: form.get("positiveIsExpense") === "on",
    });
    applyAutoLinks(db);
    message = `CSV importado: ${result.imported} gastos, ${result.skipped} filas omitidas (columnas: ${result.columns.date} / ${result.columns.description} / ${result.columns.amount}).`;
  } catch (e) {
    redirect(`/conexiones?error=${encodeURIComponent((e as Error).message)}`);
  }
  refresh();
  redirect(`/conexiones?ok=${encodeURIComponent(message)}`);
}

export async function setCategoryAction(form: FormData) {
  const category = field(form, "category");
  if (!(CATEGORIES as readonly string[]).includes(category)) return;
  setCategory(getDb(), field(form, "id"), category);
  refresh();
}

export async function toggleIgnoredAction(form: FormData) {
  setIgnored(getDb(), field(form, "id"), field(form, "ignored") === "1");
  refresh();
}

export async function unlinkAction(form: FormData) {
  unlink(getDb(), field(form, "id"));
  refresh();
}

export async function deleteAction(form: FormData) {
  const id = field(form, "id");
  // Solo se borran movimientos cargados a mano o por CSV: los sincronizados volverían solos.
  if (id.startsWith("manual:") || id.includes(":csv:")) deleteTransaction(getDb(), id);
  refresh();
}

export async function addManualAction(form: FormData) {
  const date = parseLooseDate(field(form, "date"));
  const amountCents = parseAmount(field(form, "amount"));
  const description = field(form, "description");
  const currency = field(form, "currency") === "USD" ? "USD" : "ARS";
  const category = field(form, "category");
  const installments = Number(field(form, "installments") || "1");
  if (!date || !amountCents || amountCents <= 0 || !description) return;
  const db = getDb();
  addManual(db, {
    date,
    description,
    amountCents,
    currency,
    category: (CATEGORIES as readonly string[]).includes(category) ? category : "Otros",
    installments: Number.isInteger(installments) && installments > 1 ? String(installments) : null,
  });
  applyAutoLinks(db);
  refresh();
}
