import { googleRedirectUri, splitwiseApiKey } from "@/lib/config";
import { getDb, getSetting } from "@/lib/db";
import { gmailQuery, PARSERS } from "@/lib/email";
import { gmailStatus } from "@/lib/gmail";
import type { SyncReport } from "@/lib/sync";
import {
  disconnectGmailAction,
  dismissEmailAction,
  importCsvAction,
  reprocessEmailsAction,
  syncAction,
} from "../actions";
import { SubmitButton } from "../components";

export const dynamic = "force-dynamic";

const EMAIL_STATUS_LABELS: Record<string, string> = {
  parsed: "gastos",
  skipped: "no eran gastos",
  failed: "sin entender",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function ResultLine({
  label,
  result,
}: {
  label: string;
  result: SyncReport["gmail"] | SyncReport["splitwise"];
}) {
  if (!result) return null;
  if ("error" in result) {
    return (
      <div className="status-error">
        {label}: {String(result.error)}
      </div>
    );
  }
  return (
    <div className="status-ok">
      {label}:{" "}
      {"parsed" in result
        ? `${result.parsed} gastos nuevos, ${result.skipped} mails que no eran gastos, ${result.failed} sin entender`
        : "upserted" in result
          ? `${result.upserted} gastos actualizados, ${result.removed} descartados (pagos entre amigos o borrados)`
          : ""}
    </div>
  );
}

export default async function Conexiones({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const db = getDb();
  const gmail = gmailStatus(db);
  const hasSplitwise = splitwiseApiKey() !== null;
  const splitwiseUser = getSetting<string>(db, "splitwise_user");
  const report = getSetting<SyncReport>(db, "last_sync_report");
  const failedEmails = db
    .prepare("SELECT id, parser, subject, sender, date, body, reason FROM emails WHERE status = 'failed' ORDER BY date DESC")
    .all() as { id: string; parser: string; subject: string; sender: string; date: string; body: string; reason: string }[];
  const emailCounts = db.prepare("SELECT status, COUNT(*) AS n FROM emails GROUP BY status").all() as {
    status: string;
    n: number;
  }[];

  return (
    <>
      {ok && <div className="notice ok">{ok}</div>}
      {error && <div className="notice error">{error}</div>}

      <section className="card">
        <div className="spread">
          <div>
            <h2>Sincronizar</h2>
            <div className="secondary small">
              Trae los mails nuevos de Gmail y los gastos de Splitwise, y detecta duplicados.
            </div>
          </div>
          <form action={syncAction}>
            <SubmitButton className="primary" pendingText="Sincronizando…">
              Sincronizar ahora
            </SubmitButton>
          </form>
        </div>
        {report && (
          <div className="small" style={{ marginTop: 12 }}>
            <div className="muted">Última sincronización: {formatDateTime(report.at)}</div>
            <ResultLine label="Gmail" result={report.gmail} />
            <ResultLine label="Splitwise" result={report.splitwise} />
            {report.links > 0 && (
              <div className="secondary">{report.links} gastos duplicados vinculados automáticamente</div>
            )}
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Gmail</h2>
          {!gmail.configured ? (
            <>
              <p className="status-off">No configurado</p>
              <p className="small secondary">
                Completá <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> en <code>.env.local</code>{" "}
                (ver README) y reiniciá la app. Redirect URI a autorizar en Google:{" "}
                <code>{googleRedirectUri()}</code>
              </p>
            </>
          ) : gmail.email ? (
            <>
              <p className="status-ok">Conectado como {gmail.email}</p>
              <form action={disconnectGmailAction}>
                <button>Desconectar</button>
              </form>
            </>
          ) : (
            <>
              <p className="status-off">Sin conectar</p>
              <a className="button primary" href="/api/auth/google">
                Conectar Gmail
              </a>
              <p className="small muted">Se pide acceso de solo lectura.</p>
            </>
          )}
          <h3>Búsquedas que se usan</h3>
          <ul className="small secondary">
            {PARSERS.map((p) => (
              <li key={p.id}>
                {p.label}: <code>{gmailQuery(p)}</code>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Mails procesados:{" "}
            {emailCounts.length === 0
              ? "ninguno todavía"
              : emailCounts.map((c) => `${c.n} ${EMAIL_STATUS_LABELS[c.status] ?? c.status}`).join(" · ")}
          </p>
        </section>

        <section className="card">
          <h2>Splitwise</h2>
          {hasSplitwise ? (
            <p className="status-ok">
              API key configurada{splitwiseUser ? ` (cuenta de ${splitwiseUser})` : ""}
            </p>
          ) : (
            <>
              <p className="status-off">No configurado</p>
              <p className="small secondary">
                Registrá una app en{" "}
                <a href="https://secure.splitwise.com/apps" target="_blank" rel="noreferrer">
                  secure.splitwise.com/apps
                </a>
                , generá la API key y ponela en <code>SPLITWISE_API_KEY</code> dentro de <code>.env.local</code>.
              </p>
            </>
          )}
          <p className="small secondary">
            De cada gasto de Splitwise cuenta <strong>tu parte</strong>. Si lo pagaste vos con la tarjeta o Mercado Pago,
            ese pago se vincula al gasto de Splitwise para no contarlo dos veces. Los pagos entre amigos (saldar
            deudas) no se cuentan.
          </p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>Mercado Pago</h2>
        <p className="small secondary">
          Mercado Pago no tiene una API para ver los pagos que hacés como usuario, así que hay dos caminos (se pueden usar
          los dos, los duplicados se detectan):
        </p>
        <ol className="small secondary">
          <li>
            <strong>Mails</strong>: si te llegan mails de Mercado Pago por tus pagos, se leen automáticamente al
            sincronizar Gmail. Las transferencias a personas se importan como “ignoradas” porque suelen ser devolución
            de deudas.
          </li>
          <li>
            <strong>CSV</strong>: descargá el resumen/reporte de actividad desde la web de Mercado Pago e importalo acá.
          </li>
        </ol>
        <p className="small muted">
          Los pagos que hacés en Mercado Pago con la tarjeta Santander ya llegan por el aviso de Santander
          (“MERPAGO*…”); si también están acá, se vinculan solos.
        </p>
        <form action={importCsvAction} className="form-row">
          <label>
            Archivo CSV
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <label>
            Origen
            <select name="source" defaultValue="mercadopago">
              <option value="mercadopago">Mercado Pago</option>
              <option value="csv">Otro</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" name="positiveIsExpense" />
            Los gastos vienen en positivo
          </label>
          <SubmitButton pendingText="Importando…">Importar</SubmitButton>
        </form>
      </section>

      <section className="card">
        <div className="spread">
          <div>
            <h2>Mails sin procesar ({failedEmails.length})</h2>
            <div className="small secondary">
              Mails de Santander / Mercado Pago que parecían gastos pero no se pudieron interpretar. Si hay muchos,
              probablemente el formato del mail sea distinto al esperado: copiá el texto de uno (tapando datos
              sensibles) para ajustar el parser en <code>src/lib/email/</code>.
            </div>
          </div>
          <form action={reprocessEmailsAction}>
            <SubmitButton pendingText="Reprocesando…">Reprocesar mails guardados</SubmitButton>
          </form>
        </div>
        {failedEmails.map((e) => (
          <details key={e.id} style={{ marginTop: 12 }}>
            <summary>
              <span className="small">
                {formatDateTime(e.date)} · <strong>{e.subject || "(sin asunto)"}</strong>{" "}
                <span className="muted">— {e.reason}</span>
              </span>
            </summary>
            <div className="small muted">De: {e.sender}</div>
            <pre>{e.body}</pre>
            <form action={dismissEmailAction}>
              <input type="hidden" name="id" value={e.id} />
              <button className="link">Descartar (no era un gasto)</button>
            </form>
          </details>
        ))}
      </section>
    </>
  );
}
