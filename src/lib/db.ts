import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,          -- "<fuente>:<id externo>"
  source        TEXT NOT NULL,             -- santander | mercadopago | splitwise | csv | manual
  date          TEXT NOT NULL,             -- YYYY-MM-DD (hora local)
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,          -- lo que cuenta como gasto propio (en Splitwise: tu parte)
  currency      TEXT NOT NULL,             -- ARS | USD | ...
  paid_cents    INTEGER,                   -- Splitwise: cuánto pagaste vos
  total_cents   INTEGER,                   -- Splitwise: costo total del gasto
  category      TEXT,
  card          TEXT,                      -- medio de pago: "Visa Crédito 1234", "Dinero disponible", "1234"
  installments  TEXT,                      -- cuotas, si el mail las informa
  linked_to     TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  link_locked   INTEGER NOT NULL DEFAULT 0, -- 1 = no volver a vincular automáticamente
  ignored       INTEGER NOT NULL DEFAULT 0,
  raw           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS transactions_linked_to ON transactions(linked_to);

-- Mails de Gmail ya procesados (se guarda el texto para poder reprocesarlos si se mejora un parser).
CREATE TABLE IF NOT EXISTS emails (
  id            TEXT PRIMARY KEY,          -- id del mensaje en Gmail
  parser        TEXT NOT NULL,
  status        TEXT NOT NULL,             -- parsed | skipped | failed
  subject       TEXT,
  sender        TEXT,
  date          TEXT,
  body          TEXT,
  reason        TEXT,
  processed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS emails_status ON emails(status);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// Se guarda en globalThis para que el hot reload de `next dev` no abra conexiones de más.
const globalForDb = globalThis as unknown as { __gastosDb?: DB };

export function getDb(): DB {
  globalForDb.__gastosDb ??= openDb(
    process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "gastos.db"),
  );
  return globalForDb.__gastosDb;
}

export function getSetting<T>(db: DB, key: string): T | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

export function deleteSetting(db: DB, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
