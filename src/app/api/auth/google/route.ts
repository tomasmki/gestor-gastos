import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, googleCredentials } from "@/lib/config";
import { buildAuthUrl, OAUTH_STATE_COOKIE } from "@/lib/gmail";

export function GET() {
  if (!googleCredentials()) {
    const message = "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env.local";
    return NextResponse.redirect(`${appUrl()}/conexiones?error=${encodeURIComponent(message)}`);
  }
  const state = randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
