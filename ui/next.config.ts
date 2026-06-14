import os from "node:os";
import type { NextConfig } from "next";

function normalizeAllowedOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).hostname;
  } catch {
    try {
      return new URL("http://" + trimmed.replace(/\/$/, "")).hostname;
    } catch {
      return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "").split(":")[0] ?? "";
    }
  }
}

function resolveAllowedDevOrigins(): string[] {
  const appOrigin = normalizeAllowedOrigin(process.env["NEXT_PUBLIC_APP_URL"] ?? "");
  const envValue = process.env["NEXT_ALLOWED_DEV_ORIGINS"] ?? process.env["NEXT_ALLOWED_DEV_HOSTS"] ?? "";
  const configuredOrigins = envValue
    .split(",")
    .map(normalizeAllowedOrigin)
    .filter(Boolean);

  const detectedLanOrigins = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry) && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  return Array.from(
    new Set(["localhost", "127.0.0.1", appOrigin, ...configuredOrigins, ...detectedLanOrigins].filter(Boolean))
  );
}

const nextConfig: NextConfig = {
  // Keep dev and prod outputs isolated so `next build` cannot break a running `next dev` session.
  distDir: process.env["NODE_ENV"] === "development" ? ".next-dev" : ".next",
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
