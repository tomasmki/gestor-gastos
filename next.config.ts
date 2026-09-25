import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Para poder subir CSVs de Mercado Pago más grandes que 1 MB.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
