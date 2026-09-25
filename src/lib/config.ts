// Configuración leída de variables de entorno (ver .env.example).

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function timezone(): string {
  return process.env.TIMEZONE || "America/Argentina/Buenos_Aires";
}

export function syncDays(): number {
  const n = Number(process.env.SYNC_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 180;
}

export function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function googleRedirectUri(): string {
  return `${appUrl()}/api/auth/google/callback`;
}

export function splitwiseApiKey(): string | null {
  return process.env.SPLITWISE_API_KEY || null;
}
