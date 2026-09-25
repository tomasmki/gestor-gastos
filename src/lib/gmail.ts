import { googleCredentials, googleRedirectUri } from "./config";
import { deleteSetting, getSetting, setSetting, type DB } from "./db";
import type { EmailMessage } from "./email/types";
import { htmlToText } from "./html";

// Acceso de solo lectura a Gmail vía OAuth 2.0 (sin SDK: son pocos endpoints).

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const OAUTH_STATE_COOKIE = "google_oauth_state";
const TOKENS_KEY = "google_tokens";

interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

function requireCredentials() {
  const creds = googleCredentials();
  if (!creds) throw new Error("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env.local");
  return creds;
}

export function buildAuthUrl(state: string): string {
  const { clientId } = requireCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const error = new Error(`Google OAuth: ${json.error_description ?? json.error ?? res.status}`);
    (error as Error & { code?: string }).code = json.error;
    throw error;
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in ?? 3600 };
}

export async function connectGmail(db: DB, code: string): Promise<void> {
  const { clientId, clientSecret } = requireCredentials();
  const t = await tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  if (!t.refreshToken) {
    throw new Error(
      "Google no devolvió un refresh token. Quitá el acceso de la app en https://myaccount.google.com/permissions y volvé a conectar.",
    );
  }
  const profile = await gmailFetch<{ emailAddress: string }>(t.accessToken, "/profile");
  setSetting(db, TOKENS_KEY, {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: Date.now() + t.expiresIn * 1000,
    email: profile.emailAddress,
  } satisfies GoogleTokens);
}

export function gmailStatus(db: DB): { configured: boolean; email: string | null } {
  return {
    configured: googleCredentials() !== null,
    email: getSetting<GoogleTokens>(db, TOKENS_KEY)?.email ?? null,
  };
}

export async function disconnectGmail(db: DB): Promise<void> {
  const tokens = getSetting<GoogleTokens>(db, TOKENS_KEY);
  deleteSetting(db, TOKENS_KEY);
  if (tokens) {
    // Revoca el permiso en Google; si falla no importa, el token local ya se borró.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refreshToken)}`, {
      method: "POST",
    }).catch(() => undefined);
  }
}

export async function getAccessToken(db: DB): Promise<string> {
  const tokens = getSetting<GoogleTokens>(db, TOKENS_KEY);
  if (!tokens) throw new Error("Gmail no está conectado");
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;

  const { clientId, clientSecret } = requireCredentials();
  try {
    const t = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    setSetting(db, TOKENS_KEY, {
      ...tokens,
      accessToken: t.accessToken,
      expiresAt: Date.now() + t.expiresIn * 1000,
    } satisfies GoogleTokens);
    return t.accessToken;
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant") {
      deleteSetting(db, TOKENS_KEY);
      throw new Error(
        "El acceso a Gmail venció o fue revocado (si la app de Google está en modo Testing, vence cada 7 días). Volvé a conectar Gmail.",
      );
    }
    throw e;
  }
}

async function gmailFetch<T>(token: string, path: string, params: Record<string, string | undefined> = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function searchMessageIds(token: string, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmailFetch<{ messages?: { id: string }[]; nextPageToken?: string }>(token, "/messages", {
      q,
      maxResults: "500",
      pageToken,
    });
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  internalDate: string;
  payload: GmailPart;
}

export async function getMessage(token: string, id: string): Promise<EmailMessage> {
  const msg = await gmailFetch<GmailMessage>(token, `/messages/${id}`, { format: "full" });
  const header = (name: string) =>
    msg.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  return {
    id: msg.id,
    subject: header("subject"),
    from: header("from"),
    date: new Date(Number(msg.internalDate)),
    text: extractText(msg.payload),
  };
}

function decodeBody(data: string, headers: GmailHeader[] = []): string {
  const bytes = Buffer.from(data, "base64url");
  const contentType = headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const charset = /charset="?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Texto del mail: el HTML convertido a texto si existe; si no, la parte text/plain. */
export function extractText(payload: GmailPart): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart) => {
    if (part.body?.data && part.mimeType === "text/plain") plain.push(decodeBody(part.body.data, part.headers));
    if (part.body?.data && part.mimeType === "text/html") html.push(decodeBody(part.body.data, part.headers));
    part.parts?.forEach(walk);
  };
  walk(payload);
  if (html.length) return htmlToText(html.join("\n"));
  return plain.join("\n").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
