import { type NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/config";
import { getDb } from "@/lib/db";
import { connectGmail, OAUTH_STATE_COOKIE as STATE_COOKIE } from "@/lib/gmail";

function back(params: Record<string, string>) {
  const res = NextResponse.redirect(`${appUrl()}/conexiones?${new URLSearchParams(params)}`);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const error = searchParams.get("error");
  if (error) return back({ error: `Google canceló la conexión: ${error}` });

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state || state !== req.cookies.get(STATE_COOKIE)?.value) {
    return back({ error: "La respuesta de Google no es válida (state). Probá conectar de nuevo." });
  }

  try {
    await connectGmail(getDb(), code);
  } catch (e) {
    return back({ error: (e as Error).message });
  }
  return back({ ok: "Gmail conectado. Tocá “Sincronizar ahora” para traer los gastos." });
}
