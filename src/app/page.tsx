import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { addMonths, currentMonth, formatMonth, toLocalDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  isCounted,
  listMonth,
  monthlyTotals,
  SOURCE_LABELS,
  summarize,
  type TxWithLink,
} from "@/lib/transactions";
import { addManualAction, deleteAction, toggleIgnoredAction, unlinkAction } from "./actions";
import { CategorySelect, SubmitButton } from "./components";

export const dynamic = "force-dynamic";

const HISTORY_MONTHS = 6;

function compact(cents: number): string {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
}

export default async function Home({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes } = await searchParams;
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : currentMonth();
  const db = getDb();
  const txs = listMonth(db, month);
  const summary = summarize(txs);
  const hasAnyData = txs.length > 0 || (db.prepare("SELECT 1 FROM transactions LIMIT 1").get() ?? null) !== null;

  const ars = summary.totals.find((t) => t.currency === "ARS")?.cents ?? 0;
  const otherTotals = summary.totals.filter((t) => t.currency !== "ARS");
  const arsCategories = summary.byCategory.filter((c) => c.currency === "ARS");
  const arsSources = summary.bySource.filter((s) => s.currency === "ARS");

  const firstMonth = addMonths(month, -(HISTORY_MONTHS - 1));
  const historyRows = monthlyTotals(db, firstMonth).filter((r) => r.currency === "ARS" && r.month <= month);
  const history = Array.from({ length: HISTORY_MONTHS }, (_, i) => {
    const m = addMonths(firstMonth, i);
    return { month: m, cents: historyRows.find((r) => r.month === m)?.cents ?? 0 };
  });

  return (
    <>
      <div className="month-nav">
        <Link className="button" href={`/?mes=${addMonths(month, -1)}`} aria-label="Mes anterior">
          ←
        </Link>
        <h1>{formatMonth(month)}</h1>
        <Link className="button" href={`/?mes=${addMonths(month, 1)}`} aria-label="Mes siguiente">
          →
        </Link>
      </div>

      {!hasAnyData && (
        <div className="notice">
          Todavía no hay gastos cargados. Andá a <Link href="/conexiones">Conexiones</Link> para conectar Gmail y
          Splitwise, o importar un CSV de Mercado Pago.
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="hero-label">Gastaste en {formatMonth(month).toLowerCase()}</div>
          <div className="hero">{formatMoney(ars, "ARS")}</div>
          {otherTotals.map((t) => (
            <div key={t.currency} className="tile-value">
              + {formatMoney(t.cents, t.currency)}
            </div>
          ))}
          {arsSources.length > 0 && (
            <div className="tiles">
              {arsSources.map((s) => (
                <div key={s.source}>
                  <div className="tile-label">{SOURCE_LABELS[s.source]}</div>
                  <div className="tile-value">{formatMoney(s.cents, "ARS")}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Últimos {HISTORY_MONTHS} meses (ARS)</h2>
          <MonthColumns history={history} current={month} />
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>Por categoría (ARS)</h2>
        {arsCategories.length === 0 ? (
          <p className="muted">Sin gastos en pesos este mes.</p>
        ) : (
          <CategoryBars rows={arsCategories} total={ars} />
        )}
      </section>

      <section className="card">
        <div className="spread">
          <h2>Movimientos</h2>
          <span className="muted small">
            {txs.filter(isCounted).length} cuentan · {txs.filter((t) => !isCounted(t)).length} no cuentan
            (ignorados o duplicados)
          </span>
        </div>
        {txs.length === 0 ? (
          <p className="muted">No hay movimientos en este mes.</p>
        ) : (
          <TransactionsTable txs={txs} />
        )}
      </section>

      <section className="card">
        <details>
          <summary>
            <strong>Agregar un gasto a mano</strong> <span className="muted small">(efectivo, etc.)</span>
          </summary>
          <form action={addManualAction} className="form-row" style={{ marginTop: 12 }}>
            <label>
              Fecha
              <input type="date" name="date" required defaultValue={toLocalDate(new Date())} />
            </label>
            <label style={{ flex: 1, minWidth: 180 }}>
              Descripción
              <input name="description" required placeholder="Verdulería" />
            </label>
            <label>
              Importe
              <input name="amount" required inputMode="decimal" placeholder="12.345,67" size={10} />
            </label>
            <label>
              Moneda
              <select name="currency" defaultValue="ARS">
                <option>ARS</option>
                <option>USD</option>
              </select>
            </label>
            <label>
              Categoría
              <select name="category" defaultValue="Otros">
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <SubmitButton className="primary" pendingText="Guardando…">
              Agregar
            </SubmitButton>
          </form>
        </details>
      </section>
    </>
  );
}

function MonthColumns({ history, current }: { history: { month: string; cents: number }[]; current: string }) {
  const max = Math.max(...history.map((h) => h.cents), 1);
  const shortMonth = (m: string) =>
    new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  return (
    <>
      <div className="columns" role="img" aria-label="Gasto total por mes en pesos">
        {history.map((h) => (
          <Link
            key={h.month}
            href={`/?mes=${h.month}`}
            className={`column-slot${h.month === current ? " current" : ""}`}
            data-tip={`${formatMonth(h.month)}: ${formatMoney(h.cents, "ARS")}`}
          >
            {h.month === current && h.cents > 0 && <span className="column-value">{compact(h.cents)}</span>}
            <div className="column" style={{ height: `${(Math.max(h.cents, 0) / max) * 100}%` }} />
          </Link>
        ))}
      </div>
      <div className="column-labels">
        {history.map((h) => (
          <span key={h.month}>{shortMonth(h.month)}</span>
        ))}
      </div>
    </>
  );
}

function CategoryBars({ rows, total }: { rows: { category: string; cents: number }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.cents), 1);
  return (
    <div className="hbars">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.cents / total) * 100) : 0;
        return (
          <div key={r.category} className="hbar-row">
            <span>{r.category}</span>
            <div className="hbar-track">
              <div
                className="hbar"
                style={{ width: `calc((100% - 120px) * ${Math.max(r.cents, 0) / max})` }}
                data-tip={`${pct}% del total`}
              />
              <span className="hbar-value">{formatMoney(r.cents, "ARS")}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TransactionsTable({ txs }: { txs: TxWithLink[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th className="amount">Importe</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {txs.map((tx) => (
            <tr key={tx.id} className={isCounted(tx) ? "" : "not-counted"}>
              <td style={{ whiteSpace: "nowrap" }}>{tx.date.slice(8, 10)}/{tx.date.slice(5, 7)}</td>
              <td>
                <div>{tx.description}</div>
                <div className="sub">
                  <span className="badge">{SOURCE_LABELS[tx.source]}</span>
                  {tx.card && <span className="badge">{tx.card.replace(/(\d{4})$/, "•••• $1")}</span>}
                  {tx.installments && <span className="badge">{tx.installments} cuotas</span>}
                  {tx.ignored && <span className="badge">ignorado</span>}
                </div>
                {tx.linkedTo && (
                  <div className="sub">
                    Ya contado en {tx.linkedSource ? SOURCE_LABELS[tx.linkedSource] : "otro movimiento"}:{" "}
                    {tx.linkedDescription}
                  </div>
                )}
                {tx.source === "splitwise" && tx.totalCents != null && (
                  <div className="sub">
                    Tu parte de {formatMoney(tx.totalCents, tx.currency)}
                    {tx.paidCents ? ` · pagaste ${formatMoney(tx.paidCents, tx.currency)}` : " · pagó otro"}
                  </div>
                )}
              </td>
              <td>
                <CategorySelect id={tx.id} value={tx.category} />
              </td>
              <td className="amount">
                <span className="value">{formatMoney(tx.amountCents, tx.currency)}</span>
              </td>
              <td>
                <div className="actions">
                  <form action={toggleIgnoredAction}>
                    <input type="hidden" name="id" value={tx.id} />
                    <input type="hidden" name="ignored" value={tx.ignored ? "0" : "1"} />
                    <button className="link">{tx.ignored ? "Contar" : "Ignorar"}</button>
                  </form>
                  {tx.linkedTo && (
                    <form action={unlinkAction}>
                      <input type="hidden" name="id" value={tx.id} />
                      <button className="link" title="No es el mismo gasto: contarlo aparte">
                        Desvincular
                      </button>
                    </form>
                  )}
                  {(tx.source === "manual" || tx.id.includes(":csv:")) && (
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={tx.id} />
                      <button className="link">Borrar</button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
