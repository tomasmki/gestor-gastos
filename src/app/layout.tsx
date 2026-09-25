import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestor de gastos",
  description: "Gastos de Santander, Splitwise y Mercado Pago en un solo lugar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <Link href="/" className="brand">
              Gestor de gastos
            </Link>
            <nav>
              <Link href="/">Resumen</Link>
              <Link href="/conexiones">Conexiones</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
