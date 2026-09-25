import { splitwiseApiKey, syncDays } from "./config";
import { getSetting, setSetting, type DB } from "./db";
import { gmailQuery, parserById, PARSERS } from "./email";
import type { EmailMessage, EmailParser, ParseResult } from "./email/types";
import { getAccessToken, getMessage, gmailStatus, searchMessageIds } from "./gmail";
import { applyAutoLinks } from "./matching";
import { syncSplitwise, type SplitwiseSyncResult } from "./splitwise";
import { deleteTransaction, upsertTransaction } from "./transactions";

export interface EmailCounts {
  parsed: number;
  skipped: number;
  failed: number;
}

export interface SyncReport {
  at: string;
  gmail?: EmailCounts | { error: string };
  splitwise?: SplitwiseSyncResult | { error: string };
  links: number;
}

const emptyCounts = (): EmailCounts => ({ parsed: 0, skipped: 0, failed: 0 });

/** Parsea un mail, lo registra y, si es un gasto, lo guarda como movimiento. */
export function processEmail(db: DB, parser: EmailParser, email: EmailMessage): ParseResult["status"] {
  const result = parser.parse(email);
  const txId = `${parser.id}:${email.id}`;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO emails (id, parser, status, subject, sender, date, body, reason)
       VALUES (@id, @parser, @status, @subject, @sender, @date, @body, @reason)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, reason = excluded.reason,
         processed_at = datetime('now')`,
    ).run({
      id: email.id,
      parser: parser.id,
      status: result.status,
      subject: email.subject,
      sender: email.from,
      date: email.date.toISOString(),
      body: email.text,
      reason: result.status === "parsed" ? null : result.reason,
    });
    if (result.status === "parsed") {
      upsertTransaction(db, {
        id: txId,
        source: parser.id,
        ...result.expense,
        raw: { gmailId: email.id, subject: email.subject },
      });
    } else {
      deleteTransaction(db, txId);
    }
  })();
  return result.status;
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function syncGmail(db: DB): Promise<EmailCounts> {
  const startedAt = new Date().toISOString();
  const token = await getAccessToken(db);
  const lastSync = getSetting<string>(db, "gmail_last_sync");
  // Se solapan 2 días con la sincronización anterior; los mails ya vistos se saltean.
  const since = lastSync ? Date.parse(lastSync) - 2 * 86_400_000 : Date.now() - syncDays() * 86_400_000;
  const after = Math.floor(since / 1000);

  const counts = emptyCounts();
  const alreadySeen = db.prepare("SELECT 1 FROM emails WHERE id = ?");
  for (const parser of PARSERS) {
    const ids = await searchMessageIds(token, `${gmailQuery(parser)} after:${after}`);
    const pending = ids.filter((id) => !alreadySeen.get(id));
    await mapPool(pending, 5, async (id) => {
      const email = await getMessage(token, id);
      counts[processEmail(db, parser, email)]++;
    });
  }

  setSetting(db, "gmail_last_sync", startedAt);
  return counts;
}

/** Vuelve a parsear los mails guardados (útil después de ajustar un parser). */
export function reprocessEmails(db: DB): EmailCounts {
  const rows = db.prepare("SELECT id, parser, subject, sender, date, body FROM emails").all() as {
    id: string;
    parser: string;
    subject: string;
    sender: string;
    date: string;
    body: string;
  }[];
  const counts = emptyCounts();
  for (const row of rows) {
    const parser = parserById(row.parser);
    if (!parser) continue;
    const email = { id: row.id, subject: row.subject, from: row.sender, date: new Date(row.date), text: row.body };
    counts[processEmail(db, parser, email)]++;
  }
  applyAutoLinks(db);
  return counts;
}

export async function syncAll(db: DB): Promise<SyncReport> {
  const report: SyncReport = { at: new Date().toISOString(), links: 0 };

  if (gmailStatus(db).email) {
    try {
      report.gmail = await syncGmail(db);
    } catch (e) {
      report.gmail = { error: (e as Error).message };
    }
  }

  const apiKey = splitwiseApiKey();
  if (apiKey) {
    try {
      report.splitwise = await syncSplitwise(db, apiKey);
    } catch (e) {
      report.splitwise = { error: (e as Error).message };
    }
  }

  report.links = applyAutoLinks(db);
  setSetting(db, "last_sync_report", report);
  return report;
}
