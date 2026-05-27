import os from "node:os";
import type { NextConfig } from "next";

function normalizeAllowedOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function resolveAllowedDevOrigins(): string[] {
  const devPort = process.env["PORT"]?.trim() || "3000";
  const appOrigin = normalizeAllowedOrigin(process.env["NEXT_PUBLIC_APP_URL"] ?? "");
  const envValue = process.env["NEXT_ALLOWED_DEV_ORIGINS"] ?? process.env["NEXT_ALLOWED_DEV_HOSTS"] ?? "";
  const configuredOrigins = envValue
    .split(",")
    .map(normalizeAllowedOrigin)
    .filter(Boolean);

  const detectedLanOrigins = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry) && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `${entry.address}:${devPort}`);

  return Array.from(
    new Set([`localhost:${devPort}`, `127.0.0.1:${devPort}`, appOrigin, ...configuredOrigins, ...detectedLanOrigins].filter(Boolean))
  );
}

const nextConfig: NextConfig = {
  // Allow dev asset requests from localhost and the machine's LAN IPv4 addresses.
  allowedDevOrigins: resolveAllowedDevOrigins(),
  async rewrites() {
    return [
      {
        source: "/auth/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/auth/:path*`,
      },
      {
        source: "/api/v1/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
